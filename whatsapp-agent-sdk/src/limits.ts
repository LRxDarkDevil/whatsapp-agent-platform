export const DEFAULT_BASE_URL = "https://api.whatsapp.com/agent/v1";
export const MESSAGING_PRODUCT = "whatsapp" as const;

export const SENDABLE_MESSAGE_TYPES = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
] as const;

export const RECEIVABLE_MESSAGE_TYPES = [
  ...SENDABLE_MESSAGE_TYPES,
  "reaction",
] as const;

export const TEXT_BODY_MAX = 4096;
export const CAPTION_MAX = 1024;
export const UPDATES_LIMIT_DEFAULT = 50;
export const UPDATES_LIMIT_MAX = 100;
export const UPDATES_TIMEOUT_DEFAULT = 15;
export const UPDATES_TIMEOUT_MAX = 25;
export const TYPING_INDICATOR_SECONDS = 25;
export const RETENTION_DAYS = 30;

const MB = 1024 * 1024;
const KB = 1024;

export const SIZE_LIMITS = {
  image: 5 * MB,
  sticker: 500 * KB,
  video: 16 * MB,
  audio: 16 * MB,
  document: 16 * MB,
  binary: 16 * MB,
} as const;

export type MediaCategory = keyof typeof SIZE_LIMITS;

export const MIME_CATEGORIES: Readonly<Record<string, MediaCategory>> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "sticker",
  "video/mp4": "video",
  "video/3gpp": "video",
  "audio/aac": "audio",
  "audio/mp4": "audio",
  "audio/mpeg": "audio",
  "audio/amr": "audio",
  "audio/ogg": "audio",
  "audio/opus": "audio",
  "application/pdf": "document",
  "text/plain": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "application/octet-stream": "binary",
};

export const RATE_LIMITS = {
  messages: 12,
  statuses: 12,
  "media:post": 12,
  "media:get": 12,
  "media:delete": 12,
  updates: 15,
} as const;

export type RateLimitKey = keyof typeof RATE_LIMITS;

export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function categoryForMimeType(mimeType: string): MediaCategory | undefined {
  return MIME_CATEGORIES[normalizeMimeType(mimeType)];
}

export function sizeLimitForMimeType(mimeType: string): number | undefined {
  const category = categoryForMimeType(mimeType);
  return category ? SIZE_LIMITS[category] : undefined;
}

