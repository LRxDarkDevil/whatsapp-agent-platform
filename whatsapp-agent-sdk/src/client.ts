import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import {
  CAPTION_MAX,
  DEFAULT_BASE_URL,
  MESSAGING_PRODUCT,
  SENDABLE_MESSAGE_TYPES,
  TEXT_BODY_MAX,
  UPDATES_LIMIT_DEFAULT,
  UPDATES_LIMIT_MAX,
  UPDATES_TIMEOUT_DEFAULT,
  UPDATES_TIMEOUT_MAX,
  categoryForMimeType,
  normalizeMimeType,
  sizeLimitForMimeType,
  type RateLimitKey,
} from "./limits.js";
import {
  ApiError,
  PollReplacedError,
  RateLimitError,
  ServerError,
  TransportError,
  ValidationError,
  errorFromResponse,
} from "./errors.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import type {
  AgentContact,
  AgentMessage,
  AgentOffset,
  AgentUpdate,
  AudioSendOptions,
  DocumentSendOptions,
  GetUpdatesOptions,
  ImageSendOptions,
  InboundMedia,
  MarkReadOptions,
  MediaInfo,
  MediaInput,
  MediaSource,
  MessageContext,
  MessageStatus,
  PollUpdatesOptions,
  Reaction,
  SendResult,
  SendTextOptions,
  SendableMessageType,
  StickerSendOptions,
  UploadMediaOptions,
  UserId,
  VideoSendOptions,
  WhatsAppAgentClientOptions,
} from "./types.js";

const RATE_LIMIT_BACKOFF_BASE_MS = 5_000;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".3gp": "video/3gpp",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".amr": "audio/amr",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".bin": "application/octet-stream",
};

type RequestOptions = {
  rateKey: RateLimitKey;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  readTimeoutMs?: number;
  retryUnknown?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function offsetToString(value: AgentOffset | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new ValidationError("offset must be an integer.");
    if (!Number.isSafeInteger(value)) {
      throw new ValidationError(
        "offset is outside JavaScript's safe integer range. Pass the cursor as a decimal string or bigint instead.",
      );
    }
  }
  const text = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^-?\d+$/.test(text)) throw new ValidationError("offset must be an integer.");
  if (text.startsWith("-")) return "0";
  return text.replace(/^0+(?=\d)/, "");
}

function toDate(timestamp: string | undefined): Date | undefined {
  if (!timestamp) return undefined;
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return undefined;
  return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
}

function isUserId(value: string): value is UserId {
  return value.startsWith("user:") && value.length > 5;
}

function validateRecipient(value: string): asserts value is UserId {
  if (!isUserId(value)) {
    throw new ValidationError(
      `'to' must be a WhatsApp user identifier like 'user:<id>'; received ${JSON.stringify(value)}.`,
    );
  }
}

function validateLength(field: string, value: string, maximum: number): void {
  if (value.length > maximum) {
    throw new ValidationError(`${field} is ${value.length} characters; maximum is ${maximum}.`);
  }
}

function validateCaption(caption: string | undefined): void {
  if (caption !== undefined) validateLength("caption", caption, CAPTION_MAX);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortContext(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const onAbort = (): void => controller.abort(external?.reason);

  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", onAbort, { once: true });
  }

  if (timeoutMs > 0) timeout = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function contactFromRaw(raw: unknown): AgentContact | undefined {
  const data = asRecord(raw);
  const waId = asString(data?.wa_id);
  if (!data || !waId) return undefined;
  const profile = asRecord(data.profile);
  const name = asString(profile?.name);
  return {
    waId,
    ...(name ? { name } : {}),
    raw: data,
  };
}

function contextFromRaw(raw: unknown): MessageContext | undefined {
  const data = asRecord(raw);
  if (!data) return undefined;
  const messageId = asString(data.id) ?? asString(data.message_id);
  if (!messageId) return undefined;
  const from = asString(data.from);
  return {
    messageId,
    ...(from ? { from } : {}),
    raw: data,
  };
}

function mediaFromRaw(raw: unknown): InboundMedia | undefined {
  const data = asRecord(raw);
  const id = asString(data?.id);
  if (!data || !id) return undefined;
  const mimeType = asString(data.mime_type);
  const sha256 = asString(data.sha256);
  const caption = asString(data.caption);
  const filename = asString(data.filename);
  return {
    id,
    ...(mimeType ? { mimeType } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(caption ? { caption } : {}),
    ...(filename ? { filename } : {}),
    ...(typeof data.voice === "boolean" ? { voice: data.voice } : {}),
    ...(typeof data.animated === "boolean" ? { animated: data.animated } : {}),
    raw: data,
  };
}

function reactionFromRaw(raw: unknown): Reaction | undefined {
  const data = asRecord(raw);
  if (!data) return undefined;
  const messageId = asString(data.message_id);
  const emoji = asString(data.emoji);
  if (!messageId || emoji === undefined) return undefined;
  return { messageId, emoji, removed: emoji.length === 0, raw: data };
}

function messageFromRaw(raw: unknown, names: Map<string, string>): AgentMessage | undefined {
  const data = asRecord(raw);
  if (!data) return undefined;
  const id = asString(data.id);
  const from = asString(data.from);
  const type = asString(data.type);
  if (!id || !from || !type) return undefined;

  const payload = asRecord(data[type]);
  const timestamp = asString(data.timestamp);
  const date = toDate(timestamp);
  const context = contextFromRaw(data.context);
  const profileName = names.get(from);

  const result: AgentMessage = {
    id,
    from,
    type,
    raw: data,
    ...(timestamp ? { timestamp } : {}),
    ...(date ? { date } : {}),
    ...(context ? { context } : {}),
    ...(profileName ? { profileName } : {}),
  };

  if (type === "text") {
    const text = asString(payload?.body);
    if (text !== undefined) result.text = text;
  } else if (["image", "audio", "video", "document", "sticker"].includes(type)) {
    const media = mediaFromRaw(payload);
    if (media) result.media = media;
  } else if (type === "reaction") {
    const reaction = reactionFromRaw(payload);
    if (reaction) result.reaction = reaction;
  }

  return result;
}

function statusFromRaw(raw: unknown): MessageStatus | undefined {
  const data = asRecord(raw);
  if (!data) return undefined;
  const id = asString(data.id);
  const status = asString(data.status);
  const recipientId = asString(data.recipient_id);
  if (!id || !status || !recipientId) return undefined;
  const timestamp = asString(data.timestamp);
  const date = toDate(timestamp);
  return {
    id,
    status,
    recipientId,
    ...(timestamp ? { timestamp } : {}),
    ...(date ? { date } : {}),
    raw: data,
  };
}

function normalizeUpdate(raw: unknown): AgentUpdate {
  const root = asRecord(raw) ?? {};
  const entries = asArray(root.entry);
  const contacts: AgentContact[] = [];
  const rawMessages: unknown[] = [];
  const rawStatuses: unknown[] = [];

  let agentId: string | undefined;

  for (const entryRaw of entries) {
    const entry = asRecord(entryRaw);
    if (!entry) continue;
    agentId ??= asString(entry.id);
    for (const changeRaw of asArray(entry.changes)) {
      const change = asRecord(changeRaw);
      const value = asRecord(change?.value);
      if (!value) continue;
      for (const contactRaw of asArray(value.contacts)) {
        const contact = contactFromRaw(contactRaw);
        if (contact) contacts.push(contact);
      }
      rawMessages.push(...asArray(value.messages));
      rawStatuses.push(...asArray(value.statuses));
    }
  }

  const names = new Map<string, string>();
  for (const contact of contacts) if (contact.name) names.set(contact.waId, contact.name);

  const messages = rawMessages
    .map((message) => messageFromRaw(message, names))
    .filter((message): message is AgentMessage => Boolean(message));
  const statuses = rawStatuses
    .map(statusFromRaw)
    .filter((status): status is MessageStatus => Boolean(status));
  const nextOffsetRaw = root.next_offset;
  const nextOffset =
    typeof nextOffsetRaw === "string" && /^-?\d+$/.test(nextOffsetRaw)
      ? nextOffsetRaw
      : typeof nextOffsetRaw === "number" && Number.isFinite(nextOffsetRaw)
        ? String(Math.trunc(nextOffsetRaw))
        : undefined;

  return {
    messages,
    statuses,
    contacts,
    ...(nextOffset !== undefined ? { nextOffset } : {}),
    ...(agentId ? { agentId } : {}),
    raw: root,
  };
}

function normalizeSendResult(raw: unknown): SendResult {
  const root = asRecord(raw) ?? {};
  const message = asRecord(asArray(root.messages)[0]);
  const contact = asRecord(asArray(root.contacts)[0]);
  const waId = asString(contact?.wa_id);
  const input = asString(contact?.input);
  return {
    messageId: asString(message?.id) ?? "",
    ...(waId ? { waId } : {}),
    ...(input ? { input } : {}),
    raw: root,
  };
}

function normalizeMediaInfo(raw: unknown, fallbackId: string): MediaInfo {
  const root = asRecord(raw) ?? {};
  const mimeType = asString(root.mime_type);
  const sha256 = asString(root.sha256);
  const fileSize = asNumber(root.file_size);
  return {
    id: asString(root.id) ?? fallbackId,
    url: asString(root.url) ?? "",
    ...(mimeType ? { mimeType } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(fileSize !== undefined ? { fileSize } : {}),
    raw: root,
  };
}

async function mediaBytes(
  input: MediaInput,
  options: UploadMediaOptions,
): Promise<{ bytes: Uint8Array; filename: string; mimeType: string }> {
  let bytes: Uint8Array;
  let filename = options.filename;
  let mimeType = options.mimeType;

  if (typeof input === "string") {
    bytes = new Uint8Array(await readFile(input));
    filename ??= basename(input);
    mimeType ??= MIME_BY_EXTENSION[extname(input).toLowerCase()];
  } else if (input instanceof Blob) {
    bytes = new Uint8Array(await input.arrayBuffer());
    filename ??= "upload";
    mimeType ??= input.type || undefined;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
    filename ??= "upload";
  } else {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    filename ??= "upload";
  }

  mimeType ??= filename ? MIME_BY_EXTENSION[extname(filename).toLowerCase()] : undefined;
  if (!mimeType) {
    throw new ValidationError(
      "Could not determine the media MIME type. Pass { mimeType: '...' } explicitly.",
    );
  }

  mimeType = normalizeMimeType(mimeType);
  const category = categoryForMimeType(mimeType);
  const maxBytes = sizeLimitForMimeType(mimeType);
  if (!category || maxBytes === undefined) {
    throw new ValidationError(`MIME type ${JSON.stringify(mimeType)} is not accepted by the Agent Platform.`);
  }
  if (bytes.byteLength === 0) throw new ValidationError("Refusing to upload an empty file.");
  if (bytes.byteLength > maxBytes) {
    throw new ValidationError(
      `File is ${bytes.byteLength} bytes; the ${category} limit is ${maxBytes} bytes.`,
    );
  }

  return { bytes, filename: filename ?? "upload", mimeType };
}

export class WhatsAppAgentClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  readonly retrySendOnServerError: boolean;
  readonly autoDiscoverRecipient: boolean;

  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly limiter: SlidingWindowRateLimiter | undefined;
  private recipientId?: UserId;
  private pollCount = 0;

  constructor(options: WhatsAppAgentClientOptions) {
    if (!options?.token || typeof options.token !== "string") {
      throw new ValidationError("An Agent Platform API token is required.");
    }

    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = Math.max(0, Math.trunc(options.maxRetries ?? 3));
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.backoffMaxMs = options.backoffMaxMs ?? 30_000;
    this.retrySendOnServerError = options.retrySendOnServerError ?? false;
    this.autoDiscoverRecipient = options.autoDiscoverRecipient ?? true;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? "whatsapp-agent-sdk/0.1.0";
    this.limiter = options.rateLimit === false ? undefined : new SlidingWindowRateLimiter();

    if (typeof this.fetchImpl !== "function") {
      throw new ValidationError("A Fetch API implementation is required. Use Node.js 18+ or pass options.fetch.");
    }
  }

  get recipient(): UserId | undefined {
    return this.recipientId;
  }

  async getUpdates(options: GetUpdatesOptions = {}): Promise<AgentUpdate | null> {
    const limit = clamp(options.limit ?? UPDATES_LIMIT_DEFAULT, 1, UPDATES_LIMIT_MAX);
    const timeout = clamp(options.timeout ?? UPDATES_TIMEOUT_DEFAULT, 0, UPDATES_TIMEOUT_MAX);
    const offset = offsetToString(options.offset);

    this.pollCount += 1;
    const raw = await this.request("GET", "/updates", {
      rateKey: "updates",
      query: { offset, limit, timeout },
      ...(options.signal ? { signal: options.signal } : {}),
      readTimeoutMs: timeout * 1000 + Math.max(this.timeoutMs, 15_000),
    });

    if (raw === null) return null;
    const update = normalizeUpdate(raw);
    this.learnRecipient(update);
    return update;
  }

  async *pollUpdates(options: PollUpdatesOptions = {}): AsyncGenerator<AgentUpdate, void, void> {
    let offset: AgentOffset | undefined = options.offset;
    let polls = 0;

    while (options.maxPolls === undefined || polls < options.maxPolls) {
      if (options.signal?.aborted) return;
      polls += 1;

      try {
        const update = await this.getUpdates({
          ...(offset !== undefined ? { offset } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });

        if (!update) continue;
        if (update.messages.length || update.statuses.length) yield update;

        if (update.nextOffset !== undefined) {
          offset = update.nextOffset;
          await options.onOffset?.(offset);
        }
      } catch (error) {
        if (error instanceof PollReplacedError) throw error;
        if (options.signal?.aborted) return;
        throw error;
      }
    }
  }

  async discoverRecipient(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<UserId | undefined> {
    if (this.recipientId && !options.refresh) return this.recipientId;
    await this.getUpdates({ offset: 0, limit: UPDATES_LIMIT_MAX, timeout: 0, ...(options.signal ? { signal: options.signal } : {}) });
    return this.recipientId;
  }

  async sendText(body: string, options?: SendTextOptions): Promise<SendResult>;
  async sendText(to: UserId | string, body: string, options?: SendTextOptions): Promise<SendResult>;
  async sendText(
    first: string,
    second?: string | SendTextOptions,
    third: SendTextOptions = {},
  ): Promise<SendResult> {
    const explicitRecipient = typeof second === "string";
    const to = explicitRecipient ? first : undefined;
    const body = explicitRecipient ? second : first;
    const options = explicitRecipient ? third : (second ?? {});

    validateLength("text.body", body, TEXT_BODY_MAX);
    return this.sendMessage(to, "text", {
      body,
      ...(options.previewUrl ? { preview_url: true } : {}),
    }, options.replyTo ? { replyTo: options.replyTo } : {});
  }

  async sendImage(options: ImageSendOptions): Promise<SendResult> {
    validateCaption(options.caption);
    return this.sendMediaType("image", options);
  }

  async sendVideo(options: VideoSendOptions): Promise<SendResult> {
    validateCaption(options.caption);
    return this.sendMediaType("video", options);
  }

  async sendDocument(options: DocumentSendOptions): Promise<SendResult> {
    validateCaption(options.caption);
    return this.sendMediaType("document", options);
  }

  async sendAudio(options: AudioSendOptions): Promise<SendResult> {
    return this.sendMediaType("audio", options);
  }

  async sendSticker(options: StickerSendOptions): Promise<SendResult> {
    return this.sendMediaType("sticker", options);
  }

  async sendMessage(
    to: UserId | string | undefined,
    type: SendableMessageType,
    payload: Record<string, unknown>,
    options: { replyTo?: string } = {},
  ): Promise<SendResult> {
    if (!SENDABLE_MESSAGE_TYPES.includes(type)) {
      throw new ValidationError(`Unsupported outgoing message type ${JSON.stringify(type)}.`);
    }
    const recipient = await this.resolveRecipient(to);
    validateRecipient(recipient);

    const raw = await this.request("POST", "/messages", {
      rateKey: "messages",
      json: {
        messaging_product: MESSAGING_PRODUCT,
        to: recipient,
        type,
        [type]: payload,
        ...(options.replyTo ? { context: { message_id: options.replyTo } } : {}),
      },
      retryUnknown: this.retrySendOnServerError,
    });

    const result = normalizeSendResult(raw);
    if (result.waId && isUserId(result.waId)) this.recipientId = result.waId;
    else this.recipientId = recipient;
    return result;
  }

  async reply(message: AgentMessage, body: string, options: Omit<SendTextOptions, "replyTo"> = {}): Promise<SendResult> {
    return this.sendText(message.from, body, { ...options, replyTo: message.id });
  }

  async markRead(messageId: string, options: MarkReadOptions = {}): Promise<boolean> {
    if (!messageId) throw new ValidationError("messageId is required.");
    const raw = await this.request("POST", "/statuses", {
      rateKey: "statuses",
      json: {
        messaging_product: MESSAGING_PRODUCT,
        status: "read",
        message_id: messageId,
        ...(options.typing ? { typing_indicator: { type: "text" } } : {}),
      },
    });
    return asRecord(raw)?.success === true;
  }

  sendTyping(messageId: string): Promise<boolean> {
    return this.markRead(messageId, { typing: true });
  }

  async uploadMedia(input: MediaInput, options: UploadMediaOptions = {}): Promise<string> {
    const prepared = await mediaBytes(input, options);
    const form = new FormData();
    form.set("messaging_product", MESSAGING_PRODUCT);
    form.set("type", prepared.mimeType);
    const arrayBuffer = new ArrayBuffer(prepared.bytes.byteLength);
    new Uint8Array(arrayBuffer).set(prepared.bytes);
    form.set("file", new Blob([arrayBuffer], { type: prepared.mimeType }), prepared.filename);

    const raw = await this.request("POST", "/media", { rateKey: "media:post", form });
    const id = asString(asRecord(raw)?.id);
    if (!id) throw new ApiError("Media upload succeeded but the response did not include an id.", { raw });
    return id;
  }

  async getMedia(mediaId: string): Promise<MediaInfo> {
    if (!mediaId) throw new ValidationError("mediaId is required.");
    const raw = await this.request("GET", `/media/${encodeURIComponent(mediaId)}`, { rateKey: "media:get" });
    return normalizeMediaInfo(raw, mediaId);
  }

  async downloadMedia(mediaId: string): Promise<Uint8Array>;
  async downloadMedia(mediaId: string, destination: string): Promise<string>;
  async downloadMedia(mediaId: string, destination?: string): Promise<Uint8Array | string> {
    const media = await this.getMedia(mediaId);
    if (!media.url) throw new ApiError(`Media ${JSON.stringify(mediaId)} did not include a download URL.`, { raw: media.raw });

    const { signal, cleanup } = createAbortContext(this.timeoutMs);
    try {
      const response = await this.fetchImpl(media.url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "*/*", "User-Agent": this.userAgent },
        signal,
        redirect: "error",
      });
      if (!response.ok) {
        const body = await this.parseResponseBody(response);
        throw errorFromResponse(response.status, body, response.headers);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (destination) {
        await writeFile(destination, bytes);
        return destination;
      }
      return bytes;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new TransportError(`GET ${media.url} failed.`, error);
    } finally {
      cleanup();
    }
  }

  async deleteMedia(mediaId: string): Promise<boolean> {
    if (!mediaId) throw new ValidationError("mediaId is required.");
    const raw = await this.request("DELETE", `/media/${encodeURIComponent(mediaId)}`, { rateKey: "media:delete" });
    return asRecord(raw)?.success === true;
  }

  private learnRecipient(update: AgentUpdate): void {
    const candidates = [
      ...update.messages.map((message) => message.from),
      ...update.statuses.map((status) => status.recipientId),
      ...update.contacts.map((contact) => contact.waId),
    ];
    const candidate = candidates.find((value) => isUserId(value));
    if (candidate) this.recipientId = candidate;
  }

  private async resolveRecipient(to?: string): Promise<UserId> {
    if (to) {
      validateRecipient(to);
      return to;
    }
    if (this.recipientId) return this.recipientId;

    if (this.autoDiscoverRecipient && this.pollCount === 0) {
      const discovered = await this.discoverRecipient();
      if (discovered) return discovered;
      throw new ValidationError(
        "No creator recipient is visible yet. Send the agent one WhatsApp message first, or pass to='user:<id>'.",
      );
    }

    const reason = this.pollCount > 0
      ? "This client has already polled and will not start a second discovery poll."
      : "Automatic recipient discovery is disabled.";
    throw new ValidationError(`${reason} Pass to='user:<id>' or call discoverRecipient().`);
  }

  private async sendMediaType(
    type: "image" | "audio" | "video" | "document" | "sticker",
    options: MediaSource & {
      to?: UserId | string;
      mimeType?: string;
      filename?: string;
      caption?: string;
      replyTo?: string;
    },
  ): Promise<SendResult> {
    let mediaId: string;
    if (options.mediaId) mediaId = options.mediaId;
    else {
      if (options.file === undefined) throw new ValidationError("A mediaId or file is required.");
      mediaId = await this.uploadMedia(options.file, {
      ...(options.mimeType ? { mimeType: options.mimeType } : {}),
      ...(options.filename ? { filename: options.filename } : {}),
      });
    }

    const payload: Record<string, unknown> = { id: mediaId };
    if (options.caption !== undefined) payload.caption = options.caption;
    if (type === "document" && options.filename) payload.filename = options.filename;

    return this.sendMessage(options.to, type, payload, options.replyTo ? { replyTo: options.replyTo } : {});
  }

  private async request(method: string, path: string, options: RequestOptions): Promise<unknown | null> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let attempt = 0;
    const retryUnknown = options.retryUnknown ?? true;

    while (true) {
      await this.limiter?.acquire(options.rateKey);
      const { signal, cleanup } = createAbortContext(options.readTimeoutMs ?? this.timeoutMs, options.signal);
      let response: Response;

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "User-Agent": this.userAgent,
        };
        let body: BodyInit | undefined;

        if (options.json !== undefined) {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(options.json);
        } else if (options.form) {
          body = options.form;
        }

        response = await this.fetchImpl(url, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
          signal,
        });
      } catch (error) {
        cleanup();
        if (options.signal?.aborted) throw new TransportError(`${method} ${url} aborted.`, error);
        const transport = new TransportError(`${method} ${url} failed.`, error);
        if (!retryUnknown || attempt >= this.maxRetries) throw transport;
        await this.backoff(attempt);
        attempt += 1;
        continue;
      }

      try {
        if (response.status === 204) return null;
        const parsed = await this.parseResponseBody(response);
        if (response.ok) return parsed;

        const apiError = errorFromResponse(response.status, parsed, response.headers);
        const unknownOutcome = apiError instanceof ServerError;
        const retryable = apiError.retryable && (retryUnknown || !unknownOutcome);
        if (!retryable || attempt >= this.maxRetries) throw apiError;
        await this.backoff(attempt, apiError instanceof RateLimitError ? apiError.retryAfter : undefined, apiError instanceof RateLimitError);
        attempt += 1;
      } finally {
        cleanup();
      }
    }
  }

  private async parseResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text) as unknown;
      // next_offset is a signed int64. JSON.parse would round values above
      // Number.MAX_SAFE_INTEGER, so preserve its exact decimal token as a string.
      const match = text.match(/"next_offset"\s*:\s*(-?\d+)/);
      const root = asRecord(parsed);
      if (match?.[1] && root) root.next_offset = match[1];
      return parsed;
    } catch {
      return text;
    }
  }

  private async backoff(attempt: number, retryAfterSeconds?: number, rateLimited = false): Promise<void> {
    let delay: number;
    if (retryAfterSeconds !== undefined) {
      delay = Math.min(this.backoffMaxMs, Math.max(0, retryAfterSeconds * 1000));
    } else {
      const base = rateLimited
        ? Math.max(this.backoffBaseMs, RATE_LIMIT_BACKOFF_BASE_MS)
        : this.backoffBaseMs;
      delay = Math.min(this.backoffMaxMs, base * 2 ** attempt);
      delay += Math.floor(Math.random() * Math.max(1, delay * 0.1));
    }
    await sleep(delay);
  }
}
