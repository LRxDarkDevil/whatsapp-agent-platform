export class WhatsAppAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends WhatsAppAgentError {}

export class TransportError extends WhatsAppAgentError {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export interface ApiErrorOptions {
  status?: number;
  code?: number;
  details?: string;
  fbtraceId?: string;
  errorType?: string;
  raw?: unknown;
  retryAfter?: number;
}

export class ApiError extends WhatsAppAgentError {
  readonly status: number | undefined;
  readonly code: number | undefined;
  readonly details: string | undefined;
  readonly fbtraceId: string | undefined;
  readonly errorType: string | undefined;
  readonly raw: unknown;
  readonly retryAfter: number | undefined;
  readonly retryable: boolean = false;

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.fbtraceId = options.fbtraceId;
    this.errorType = options.errorType;
    this.raw = options.raw;
    this.retryAfter = options.retryAfter;
  }
}

export class AuthenticationError extends ApiError {}
export class InvalidRequestError extends ApiError {}
export class ForbiddenError extends ApiError {}
export class NotFoundError extends ApiError {}
export class MediaNotFoundError extends NotFoundError {}
export class MediaUploadError extends InvalidRequestError {}

export class RateLimitError extends ApiError {
  override readonly retryable = true;
}

export class NotDeliveredError extends ApiError {
  override readonly retryable = true;
}

export class PollReplacedError extends ApiError {}

export class ServerError extends ApiError {
  override readonly retryable = true;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numericCode(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
}

export function errorFromResponse(
  status: number,
  body: unknown,
  headers?: Headers,
): ApiError {
  const root = asRecord(body);
  const error = asRecord(root?.error) ?? {};
  const errorData = asRecord(error.error_data) ?? {};
  const code = numericCode(error.code);
  const message =
    typeof error.message === "string"
      ? error.message
      : typeof body === "string" && body.trim()
        ? `HTTP ${status}: ${body.trim().slice(0, 200)}`
        : `HTTP ${status}`;

  let ErrorClass: typeof ApiError = ApiError;

  if (code === 2) ErrorClass = ServerError;
  else if (code === 100 && status === 404) ErrorClass = MediaNotFoundError;
  else if (code === 100 || code === 131009) ErrorClass = InvalidRequestError;
  else if (code === 190) ErrorClass = AuthenticationError;
  else if (code === 130429) ErrorClass = RateLimitError;
  else if (code === 131005) ErrorClass = ForbiddenError;
  else if (code === 131016) ErrorClass = NotDeliveredError;
  else if (code === 131053) ErrorClass = MediaUploadError;
  else if (code === 1752041) ErrorClass = PollReplacedError;
  else if (status === 400) ErrorClass = InvalidRequestError;
  else if (status === 401) ErrorClass = AuthenticationError;
  else if (status === 403) ErrorClass = ForbiddenError;
  else if (status === 404) ErrorClass = NotFoundError;
  else if (status === 409) ErrorClass = PollReplacedError;
  else if (status === 429) ErrorClass = RateLimitError;
  else if (status >= 500) ErrorClass = ServerError;

  const retryAfterHeader = headers?.get("Retry-After");
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  let details = typeof errorData.details === "string" ? errorData.details : undefined;

  if (ErrorClass === PollReplacedError && !details) {
    details = "Another poll for this agent replaced this one. Run only one poll loop per API key.";
  }

  return new ErrorClass(message, {
    status,
    ...(code !== undefined ? { code } : {}),
    ...(details ? { details } : {}),
    ...(typeof error.fbtrace_id === "string" ? { fbtraceId: error.fbtrace_id } : {}),
    ...(typeof error.type === "string" ? { errorType: error.type } : {}),
    raw: body,
    ...(retryAfter !== undefined && Number.isFinite(retryAfter) ? { retryAfter } : {}),
  });
}
