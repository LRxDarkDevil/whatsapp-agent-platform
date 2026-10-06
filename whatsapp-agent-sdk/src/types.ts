export type UserId = `user:${string}`;
export type AgentId = string;
export type ParticipantId = UserId | `agent:${string}`;
/**
 * Update cursors are signed 64-bit integers on the wire. Strings are used for
 * returned cursors so JavaScript never loses precision above Number.MAX_SAFE_INTEGER.
 */
export type AgentOffset = string | number | bigint;

export type SendableMessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker";

export type ReceivableMessageType = SendableMessageType | "reaction";

export interface AgentContact {
  waId: UserId | string;
  name?: string;
  raw: Record<string, unknown>;
}

export interface MessageContext {
  messageId: string;
  from?: ParticipantId | string;
  raw: Record<string, unknown>;
}

export interface InboundMedia {
  id: string;
  mimeType?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
  animated?: boolean;
  raw: Record<string, unknown>;
}

export interface Reaction {
  messageId: string;
  emoji: string;
  removed: boolean;
  raw: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  from: UserId | string;
  type: ReceivableMessageType | string;
  timestamp?: string;
  date?: Date;
  text?: string;
  media?: InboundMedia;
  reaction?: Reaction;
  context?: MessageContext;
  profileName?: string;
  raw: Record<string, unknown>;
}

export interface MessageStatus {
  id: string;
  status: "delivered" | "read" | string;
  recipientId: UserId | string;
  timestamp?: string;
  date?: Date;
  raw: Record<string, unknown>;
}

export interface AgentUpdate {
  messages: AgentMessage[];
  statuses: MessageStatus[];
  contacts: AgentContact[];
  nextOffset?: string;
  agentId?: AgentId;
  raw: Record<string, unknown>;
}

export interface SendResult {
  messageId: string;
  waId?: UserId | string;
  input?: string;
  raw: Record<string, unknown>;
}

export interface MediaInfo {
  id: string;
  url: string;
  mimeType?: string;
  sha256?: string;
  fileSize?: number;
  raw: Record<string, unknown>;
}

export interface GetUpdatesOptions {
  offset?: AgentOffset;
  limit?: number;
  timeout?: number;
  signal?: AbortSignal;
}

export interface PollUpdatesOptions extends GetUpdatesOptions {
  maxPolls?: number;
  onOffset?: (nextOffset: string) => void | Promise<void>;
}

export interface SendTextOptions {
  previewUrl?: boolean;
  replyTo?: string;
}

export type MediaInput = string | Blob | ArrayBuffer | Uint8Array;

export type MediaSource =
  | { mediaId: string; file?: never }
  | { mediaId?: never; file: MediaInput };

export interface BaseMediaSendOptions {
  to?: UserId | string;
  mimeType?: string;
  filename?: string;
  replyTo?: string;
}

export type ImageSendOptions = MediaSource & BaseMediaSendOptions & { caption?: string };
export type VideoSendOptions = MediaSource & BaseMediaSendOptions & { caption?: string };
export type DocumentSendOptions = MediaSource & BaseMediaSendOptions & { caption?: string };
export type AudioSendOptions = MediaSource & BaseMediaSendOptions;
export type StickerSendOptions = MediaSource & BaseMediaSendOptions;

export interface UploadMediaOptions {
  mimeType?: string;
  filename?: string;
}

export interface MarkReadOptions {
  typing?: boolean;
}

export interface WhatsAppAgentClientOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  rateLimit?: boolean;
  retrySendOnServerError?: boolean;
  autoDiscoverRecipient?: boolean;
  fetch?: typeof fetch;
  userAgent?: string;
}
