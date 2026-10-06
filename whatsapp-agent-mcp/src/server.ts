import { lstat, realpath } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import {
  WhatsAppAgentClient,
  type AgentMessage,
  type AgentUpdate,
  type MessageStatus,
} from "whatsapp-agent-sdk";

export interface WhatsAppAgentMcpServerOptions {
  token?: string;
  client?: WhatsAppAgentClient;
  allowFileIO?: boolean;
  fileRoot?: string;
}

const SERVER_VERSION = "0.1.0";

function toJsonValue(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function compactMessage(message: AgentMessage): Record<string, unknown> {
  return {
    id: message.id,
    from: message.from,
    type: message.type,
    ...(message.timestamp ? { timestamp: message.timestamp } : {}),
    ...(message.text !== undefined ? { text: message.text } : {}),
    ...(message.profileName ? { profileName: message.profileName } : {}),
    ...(message.media
      ? {
          media: {
            id: message.media.id,
            ...(message.media.mimeType ? { mimeType: message.media.mimeType } : {}),
            ...(message.media.caption !== undefined ? { caption: message.media.caption } : {}),
            ...(message.media.filename ? { filename: message.media.filename } : {}),
            ...(message.media.voice !== undefined ? { voice: message.media.voice } : {}),
            ...(message.media.animated !== undefined ? { animated: message.media.animated } : {}),
          },
        }
      : {}),
    ...(message.reaction
      ? {
          reaction: {
            messageId: message.reaction.messageId,
            emoji: message.reaction.emoji,
            removed: message.reaction.removed,
          },
        }
      : {}),
    ...(message.context
      ? {
          context: {
            messageId: message.context.messageId,
            ...(message.context.from ? { from: message.context.from } : {}),
          },
        }
      : {}),
  };
}

function compactStatus(status: MessageStatus): Record<string, unknown> {
  return {
    id: status.id,
    status: status.status,
    recipientId: status.recipientId,
    ...(status.timestamp ? { timestamp: status.timestamp } : {}),
  };
}

function compactUpdate(update: AgentUpdate): Record<string, unknown> {
  return {
    agentId: update.agentId ?? null,
    nextOffset: update.nextOffset ?? null,
    messages: update.messages.map(compactMessage),
    statuses: update.statuses.map(compactStatus),
    contacts: update.contacts.map((contact) => ({
      waId: contact.waId,
      ...(contact.name ? { name: contact.name } : {}),
    })),
  };
}

function lexicallyInsideRoot(root: string, inputPath: string): string {
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, inputPath);
  const rel = relative(rootPath, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return candidate;
  throw new Error(`File path must stay inside configured file root: ${rootPath}`);
}

function assertInsideRealRoot(realRoot: string, candidate: string): void {
  const rel = relative(realRoot, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`Resolved file path escapes configured file root: ${realRoot}`);
}

async function readablePathInsideRoot(root: string, inputPath: string): Promise<string> {
  const candidate = lexicallyInsideRoot(root, inputPath);
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  assertInsideRealRoot(realRoot, realCandidate);
  return realCandidate;
}

async function writablePathInsideRoot(root: string, inputPath: string): Promise<string> {
  const candidate = lexicallyInsideRoot(root, inputPath);
  const realRoot = await realpath(root);
  const realParent = await realpath(dirname(candidate));
  assertInsideRealRoot(realRoot, realParent);

  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) {
      throw new Error("Refusing to write through a symbolic-link destination.");
    }
    const existingRealPath = await realpath(candidate);
    assertInsideRealRoot(realRoot, existingRealPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return candidate;
    }
    throw error;
  }

  return candidate;
}

function createClient(options: WhatsAppAgentMcpServerOptions): WhatsAppAgentClient {
  if (options.client) return options.client;
  if (!options.token) {
    throw new Error("WHATSAPP_AGENT_TOKEN is required to create the WhatsApp Agent MCP server.");
  }
  return new WhatsAppAgentClient({ token: options.token });
}

export function createWhatsAppAgentMcpServer(
  options: WhatsAppAgentMcpServerOptions,
): McpServer {
  const client = createClient(options);
  const allowFileIO = options.allowFileIO ?? false;
  const fileRoot = options.fileRoot ? resolve(options.fileRoot) : undefined;

  if (allowFileIO && !fileRoot) {
    throw new Error("fileRoot is required when allowFileIO is enabled.");
  }

  const server = new McpServer({
    name: "whatsapp-agent-mcp",
    version: SERVER_VERSION,
  });

  server.registerTool(
    "whatsapp_agent_status",
    {
      title: "WhatsApp agent status",
      description:
        "Check whether the WhatsApp Agent Platform API is reachable and whether the creator can be identified from the retained agent buffer. This does not mark messages as read.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const update = await client.getUpdates({ offset: "0", limit: 100, timeout: 0 });
        return result({
          connected: true,
          agentId: update?.agentId ?? null,
          nextOffset: update?.nextOffset ?? null,
          creatorKnown: Boolean(client.recipient),
          retainedMessages: update?.messages.length ?? 0,
          retainedStatuses: update?.statuses.length ?? 0,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "whatsapp_get_updates",
    {
      title: "Get WhatsApp agent updates",
      description:
        "Read retained messages and delivery/read statuses from this agent's private WhatsApp conversation. Polling itself does not mark messages read. Pass nextOffset back unchanged on the next call.",
      inputSchema: z.object({
        offset: z.string().regex(/^\d+$/).optional().describe("Exact decimal cursor returned by nextOffset. Use 0 to replay retained updates."),
        limit: z.number().int().min(1).max(100).default(50),
        timeoutSeconds: z.number().int().min(0).max(25).default(0),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ offset, limit, timeoutSeconds }) => {
      try {
        const update = await client.getUpdates({
          ...(offset !== undefined ? { offset } : {}),
          limit,
          timeout: timeoutSeconds,
        });
        return result(
          update
            ? compactUpdate(update)
            : {
                empty: true,
                nextOffset: offset ?? null,
                messages: [],
                statuses: [],
                contacts: [],
              },
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "whatsapp_send_text",
    {
      title: "Send WhatsApp text",
      description:
        "Send a text message from the agent to its creator. The Agent Platform only allows messaging the creator; arbitrary phone numbers are not supported.",
      inputSchema: z.object({
        text: z.string().min(1).max(4096),
        previewUrl: z.boolean().default(false),
        replyTo: z.string().min(1).optional().describe("Optional inbound wamid to quote."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ text, previewUrl, replyTo }) => {
      try {
        const sent = await client.sendText(text, {
          previewUrl,
          ...(replyTo ? { replyTo } : {}),
        });
        return result({
          sent: true,
          messageId: sent.messageId,
          recipient: sent.waId ?? client.recipient ?? null,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "whatsapp_mark_read",
    {
      title: "Mark WhatsApp message read",
      description:
        "Mark an inbound agent-chat message as read. Optionally show a typing indicator. Marking read removes that message from the replayable retained buffer.",
      inputSchema: z.object({
        messageId: z.string().min(1),
        typing: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ messageId, typing }) => {
      try {
        const success = await client.markRead(messageId, { typing });
        return result({ success, messageId, typing });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "whatsapp_send_media",
    {
      title: "Send WhatsApp media",
      description:
        "Send an already-uploaded Agent Platform media ID to the agent creator as an image, audio file, video, document, or sticker.",
      inputSchema: z.object({
        type: z.enum(["image", "audio", "video", "document", "sticker"]),
        mediaId: z.string().min(1),
        caption: z.string().max(1024).optional(),
        filename: z.string().min(1).optional(),
        replyTo: z.string().min(1).optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ type, mediaId, caption, filename, replyTo }) => {
      try {
        if ((type === "audio" || type === "sticker") && caption !== undefined) {
          throw new Error(`Captions are not supported for ${type}.`);
        }
        if (type !== "document" && filename !== undefined) {
          throw new Error("filename is only supported for documents.");
        }

        const common = {
          mediaId,
          ...(replyTo ? { replyTo } : {}),
        };

        const sent =
          type === "image"
            ? await client.sendImage({ ...common, ...(caption !== undefined ? { caption } : {}) })
            : type === "video"
              ? await client.sendVideo({ ...common, ...(caption !== undefined ? { caption } : {}) })
              : type === "audio"
                ? await client.sendAudio(common)
                : type === "sticker"
                  ? await client.sendSticker(common)
                  : await client.sendDocument({
                      ...common,
                      ...(caption !== undefined ? { caption } : {}),
                      ...(filename ? { filename } : {}),
                    });

        return result({
          sent: true,
          type,
          messageId: sent.messageId,
          recipient: sent.waId ?? client.recipient ?? null,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "whatsapp_get_media",
    {
      title: "Get WhatsApp media metadata",
      description:
        "Get metadata for an Agent Platform media ID. This returns metadata only; it does not expose the WhatsApp bearer token.",
      inputSchema: z.object({ mediaId: z.string().min(1) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ mediaId }) => {
      try {
        const media = await client.getMedia(mediaId);
        return result({
          id: media.id,
          mimeType: media.mimeType ?? null,
          sha256: media.sha256 ?? null,
          fileSize: media.fileSize ?? null,
          // Deliberately omit the authenticated download URL from model-visible output.
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  if (allowFileIO && fileRoot) {
    server.registerTool(
      "whatsapp_upload_media_file",
      {
        title: "Upload local file to WhatsApp",
        description:
          `Upload a local file to the Agent Platform. File access is restricted to the configured root: ${fileRoot}`,
        inputSchema: z.object({
          path: z.string().min(1).describe("Path inside the configured file root."),
          mimeType: z.string().min(1).optional(),
          filename: z.string().min(1).optional(),
        }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ path, mimeType, filename }) => {
        try {
          const safePath = await readablePathInsideRoot(fileRoot, path);
          const mediaId = await client.uploadMedia(safePath, {
            ...(mimeType ? { mimeType } : {}),
            ...(filename ? { filename } : {}),
          });
          return result({ mediaId, sourcePath: path });
        } catch (error) {
          return toolError(error);
        }
      },
    );

    server.registerTool(
      "whatsapp_download_media_file",
      {
        title: "Download WhatsApp media to local file",
        description:
          `Download Agent Platform media into the configured file root: ${fileRoot}`,
        inputSchema: z.object({
          mediaId: z.string().min(1),
          path: z.string().min(1).describe("Destination path inside the configured file root."),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ mediaId, path }) => {
        try {
          const safePath = await writablePathInsideRoot(fileRoot, path);
          await client.downloadMedia(mediaId, safePath);
          return result({ downloaded: true, mediaId, destinationPath: path });
        } catch (error) {
          return toolError(error);
        }
      },
    );
  }

  server.registerResource(
    "whatsapp-agent-capabilities",
    "whatsapp-agent://capabilities",
    {
      title: "WhatsApp Agent Platform capabilities",
      description: "Current constraints and safety notes for this MCP server.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              creatorOnly: true,
              canReadOtherWhatsAppChats: false,
              inboundTransport: "long-polling",
              supportedOutbound: ["text", "image", "audio", "video", "document", "sticker"],
              reactions: "receive-only",
              fileIOEnabled: allowFileIO,
              note: "Agent Platform chat is distinct from normal WhatsApp chats and is not treated as end-to-end encrypted by WhatsApp.",
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}
