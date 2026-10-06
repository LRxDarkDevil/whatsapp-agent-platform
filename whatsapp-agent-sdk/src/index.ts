export { WhatsAppAgentClient } from "./client.js";

export * from "./types.js";
export * from "./errors.js";
export {
  DEFAULT_BASE_URL,
  MESSAGING_PRODUCT,
  SENDABLE_MESSAGE_TYPES,
  RECEIVABLE_MESSAGE_TYPES,
  TEXT_BODY_MAX,
  CAPTION_MAX,
  UPDATES_LIMIT_DEFAULT,
  UPDATES_LIMIT_MAX,
  UPDATES_TIMEOUT_DEFAULT,
  UPDATES_TIMEOUT_MAX,
  TYPING_INDICATOR_SECONDS,
  RETENTION_DAYS,
  SIZE_LIMITS,
  MIME_CATEGORIES,
  RATE_LIMITS,
  normalizeMimeType,
  categoryForMimeType,
  sizeLimitForMimeType,
} from "./limits.js";

