# API reference

## `new WhatsAppAgentClient(options)`

```ts
const client = new WhatsAppAgentClient({
  token,
  baseUrl: "https://api.whatsapp.com/agent/v1",
  timeoutMs: 30_000,
  maxRetries: 3,
  backoffBaseMs: 500,
  backoffMaxMs: 30_000,
  rateLimit: true,
  retrySendOnServerError: false,
  autoDiscoverRecipient: true,
});
```

Options:

| Option | Default | Meaning |
|---|---|---|
| `token` | required | Agent API bearer token |
| `baseUrl` | `https://api.whatsapp.com/agent/v1` | Override for tests/proxies |
| `timeoutMs` | `30000` | Ordinary request timeout |
| `maxRetries` | `3` | Retry count for retryable/known-safe failures |
| `backoffBaseMs` | `500` | Base exponential retry delay |
| `backoffMaxMs` | `30000` | Maximum retry delay |
| `rateLimit` | `true` | Pace calls under documented per-method budgets |
| `retrySendOnServerError` | `false` | Retry ambiguous `POST /messages` failures; may duplicate |
| `autoDiscoverRecipient` | `true` | Before a send-only first call, read retained updates to discover creator |
| `fetch` | global `fetch` | Custom Fetch implementation, useful for tests |
| `userAgent` | `whatsapp-agent-sdk/0.1.0` | HTTP User-Agent |

## Updates

### `getUpdates(options?)`

Maps to `GET /updates`.

```ts
const update = await client.getUpdates({
  offset: cursor,
  limit: 50,
  timeout: 15,
});
```

Returns `AgentUpdate | null`. HTTP 204 becomes `null` and does not invent/advance a cursor.

`AgentUpdate` contains normalized `messages`, `statuses`, `contacts`, `agentId`, `nextOffset`, and `raw`. Unknown raw fields remain available for forward compatibility.

`nextOffset` is returned as a decimal string to preserve signed-int64 precision.

### `pollUpdates(options?)`

Async generator around long polling.

```ts
for await (const update of client.pollUpdates({
  offset: savedCursor,
  timeout: 25,
  onOffset: saveCursor,
})) {
  // process update
}
```

Persist a cursor only after your handler succeeds. Only one long poll should run per agent API key.

### `discoverRecipient({ refresh?, signal? })`

Reads the retained buffer with `offset=0`, `limit=100`, `timeout=0` and learns the creator's opaque `user:<id>` from messages/statuses/contacts.

Polling does not consume updates. If the buffer is empty, no creator can be discovered until the creator sends the agent a message (or you provide a known `user:<id>` explicitly).

## Sending

### `sendText(body, options?)`

### `sendText(to, body, options?)`

Maps to `POST /messages` with `type: "text"`.

Options: `previewUrl`, `replyTo`.

### `reply(message, body, options?)`

Sends text to `message.from` and quotes `message.id`.

### Media send helpers

- `sendImage(options)`
- `sendVideo(options)`
- `sendAudio(options)`
- `sendDocument(options)`
- `sendSticker(options)`

Each accepts either `{ mediaId }` or `{ file }`, plus optional `to`, `mimeType`, `filename`, and `replyTo`. Image/video/document also accept `caption`.

`file` may be a filesystem path, `Blob`, `ArrayBuffer`, or `Uint8Array`.

## Status/read APIs

### `markRead(messageId, { typing? })`

Maps to `POST /statuses`.

### `sendTyping(messageId)`

Equivalent to `markRead(messageId, { typing: true })`.

## Media APIs

### `uploadMedia(file, options?)`

Maps to multipart `POST /media` with fields `messaging_product`, `type`, and `file`.

Returns the media ID string.

### `getMedia(mediaId)`

Maps to `GET /media/:id`. Returns URL, MIME type, SHA-256, file size, and raw response.

### `downloadMedia(mediaId)`

Returns `Uint8Array`.

### `downloadMedia(mediaId, destinationPath)`

Writes bytes to the destination path and returns that path.

The authenticated content fetch does not follow redirects, preventing the bearer token from being forwarded to a redirect target.

### `deleteMedia(mediaId)`

Maps to `DELETE /media/:id` and returns the server's `success` boolean.

## Normalized inbound message model

`AgentMessage` contains:

- `id`
- `from` (`user:<id>`)
- `type`
- `timestamp` and parsed `date`
- `text` for text messages
- `media` for image/audio/video/document/sticker
- `reaction` for inbound reactions
- `context` for quoted messages
- `profileName` when contacts include one
- `raw`

Inbound quote context uses `context.id`; outbound reply requests use `context.message_id`. The SDK normalizes this difference.

## Errors

Hierarchy:

- `WhatsAppAgentError`
  - `ValidationError`
  - `TransportError`
  - `ApiError`
    - `AuthenticationError`
    - `InvalidRequestError`
    - `ForbiddenError`
    - `NotFoundError`
      - `MediaNotFoundError`
    - `MediaUploadError`
    - `RateLimitError`
    - `NotDeliveredError`
    - `PollReplacedError`
    - `ServerError`

`ApiError` exposes `status`, `code`, `details`, `fbtraceId`, `errorType`, `raw`, `retryAfter`, and `retryable`.

Common mappings:

| API condition | SDK error |
|---|---|
| HTTP 401 / code 190 | `AuthenticationError` |
| HTTP 403 / code 131005 | `ForbiddenError` |
| HTTP 409 / code 1752041 | `PollReplacedError` |
| HTTP 429 / code 130429 | `RateLimitError` |
| code 131016 | `NotDeliveredError` |
| code 131053 | `MediaUploadError` |
| HTTP 5xx / code 2 | `ServerError` |

## Media formats

Accepted upload types enforced by the SDK:

- Images: `image/jpeg`, `image/png` — 5 MiB.
- Sticker: `image/webp` — 500 KiB.
- Video: `video/mp4`, `video/3gpp` — 16 MiB.
- Audio: AAC, MP4/M4A, MPEG/MP3, AMR, OGG, OPUS — 16 MiB.
- Documents: PDF, plain text, DOC/DOCX, XLS/XLSX, PPT/PPTX — 16 MiB.
- Generic binary: `application/octet-stream` — 16 MiB.

The SDK infers MIME type from common file extensions. For in-memory buffers, pass `mimeType` explicitly.

