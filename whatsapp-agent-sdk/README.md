# whatsapp-agent-sdk

Community TypeScript/Node.js SDK for WhatsApp's **Agent Platform API** (`/agent/v1`) — the API for personal third-party agents created inside WhatsApp.

> **Community project.** This is not an official WhatsApp or Meta SDK and is not affiliated with, endorsed by, sponsored by, or maintained by WhatsApp or Meta.

## Why this exists

WhatsApp's Agent Platform is different from both the WhatsApp Business Cloud API and unofficial WhatsApp Web libraries such as Baileys.

| | Agent Platform | Business Cloud API | WhatsApp Web / Baileys |
|---|---|---|---|
| Intended use | Personal third-party agents | Businesses messaging customers | Automating a linked WhatsApp client |
| Setup | Create an agent in WhatsApp and copy its API key | Meta developer/business setup | QR/link-device flow |
| Inbound transport | Long polling | Webhooks | WhatsApp Web protocol |
| Current recipient model | Agent creator | Business customers | Depends on linked account |
| Official API | Yes | Yes | No |

This package wraps the official Agent Platform HTTP API while adding typed models, exact cursor handling, retries, rate limiting, validation, creator discovery, and media helpers.

## Requirements

- Node.js **18+**.
- A WhatsApp account that currently has the **Agents** feature. Availability is still limited and may differ by account/country.
- An Agent Platform API key created inside WhatsApp.

## Install

```bash
npm install whatsapp-agent-sdk
```

## Get an API key

In WhatsApp:

1. Open **Settings**.
2. Open **Agents**.
3. Create an agent.
4. Open the agent chat and its **Chat info**.
5. Copy the **API key**.

Store the key as a server-side secret. Do not expose it in browser code, commit it to Git, put it in URLs, or log it.

```bash
WHATSAPP_AGENT_TOKEN=your_api_key
```

## Quick start

```ts
import { WhatsAppAgentClient } from "whatsapp-agent-sdk";

const client = new WhatsAppAgentClient({
  token: process.env.WHATSAPP_AGENT_TOKEN!,
});

// If the retained Agent Platform buffer contains a creator update, the SDK
// discovers the creator automatically before the first send.
const sent = await client.sendText("Hello from my agent 👋");
console.log(sent.messageId);
```

If the retained buffer is empty, send the agent one message from WhatsApp first, or pass the creator's opaque `user:<id>` identifier explicitly.

## Receive messages

The Agent Platform uses **long polling**, not a public webhook.

```ts
const client = new WhatsAppAgentClient({
  token: process.env.WHATSAPP_AGENT_TOKEN!,
});

for await (const update of client.pollUpdates({ offset: 0 })) {
  for (const message of update.messages) {
    if (message.type !== "text" || !message.text) continue;

    // Optional: marks the message read and shows typing.
    await client.sendTyping(message.id);

    await client.reply(message, `You said: ${message.text}`);
  }

  // Persist only AFTER your processing succeeds.
  if (update.nextOffset) {
    await saveCursor(update.nextOffset);
  }
}
```

### Cursor safety

`next_offset` is a signed 64-bit integer in the protocol. JavaScript numbers cannot represent every 64-bit integer exactly, so this SDK returns `update.nextOffset` as a **decimal string**. Pass that string back to `offset` unchanged.

```ts
const update = await client.getUpdates({ offset: "9223372036854775807" });
```

Never increment or calculate the cursor yourself.

## Send messages

### Text

```ts
await client.sendText("Hello");

await client.sendText("user:123...", "Hello");

await client.sendText("user:123...", "See this link", {
  previewUrl: true,
});
```

### Quote/reply

```ts
await client.reply(message, "Got it.");

await client.sendText(message.from, "Got it.", {
  replyTo: message.id,
});
```

### Images, video, audio, documents, stickers

Upload and send a local file in one call:

```ts
await client.sendImage({
  file: "./photo.jpg",
  caption: "Photo from my agent",
});

await client.sendDocument({
  file: "./report.pdf",
  filename: "report.pdf",
  caption: "Report",
});
```

Or reuse a media ID:

```ts
const mediaId = await client.uploadMedia("./photo.jpg");
await client.sendImage({ mediaId, caption: "Uploaded once" });
```

## Read receipts and typing

```ts
await client.markRead(message.id);
await client.sendTyping(message.id);
```

`sendTyping()` also marks the message read. A typing indicator clears after a reply or roughly 25 seconds.

**Important:** marking an inbound message read removes that message from the replayable retained update buffer. If replay-after-crash matters, process successfully before marking read.

## Media

```ts
const media = await client.getMedia(message.media!.id);
console.log(media.mimeType, media.fileSize);

const bytes = await client.downloadMedia(message.media!.id);
await client.downloadMedia(message.media!.id, "./downloaded-file");

await client.deleteMedia(message.media!.id);
```

The media download URL returned by WhatsApp requires the same bearer token. The SDK refuses HTTP redirect following for authenticated media downloads so the token is not forwarded to a redirect target.

## Current platform limits

The SDK validates/paces against the limits documented for Agent Platform v1:

| Operation | Limit |
|---|---:|
| `POST /messages` | 12/minute/agent |
| `POST /statuses` | 12/minute/agent |
| `GET /updates` | 15/minute/agent |
| `POST /media` | 12/minute/agent |
| `GET /media/:id` | 12/minute/agent |
| `DELETE /media/:id` | 12/minute/agent |

Other useful caps:

- Text: **4096 characters**.
- Media caption: **1024 characters**.
- Image: JPEG/PNG, up to **5 MiB**.
- Sticker: WebP, up to **500 KiB**.
- Video/audio/document: up to **16 MiB**.
- Poll `limit`: max **100**.
- Long-poll timeout: max **25 seconds**.
- Retained Agent Platform updates and uploaded media: up to **30 days**.

These limits belong to the evolving Agent Platform and may change. Check the official developer manual before relying on them for long-lived production behavior.

## Important platform behavior

- **Creator-only today:** the API currently sends to the agent creator using an opaque `user:<id>`, not an E.164 phone number.
- **No access to other chats:** an agent cannot read your normal WhatsApp chats or be added to them through this API.
- **One poller per API key:** a newer `GET /updates` poll replaces an older one. The older poll receives HTTP 409 / code `1752041`.
- **Polling does not consume updates:** `offset=0` replays the retained buffer. Read receipts can remove inbound messages from replay.
- **204 means no update:** retry with the same cursor.
- **At-least-once handling:** persist the cursor after successful processing and deduplicate by message ID if necessary.
- **No exact ordering guarantee for concurrent sends:** serialize sends yourself when strict ordering matters.
- **Not a full WhatsApp client API:** message edits/deletes, outbound reactions, groups, buttons/lists, command menus, and voice-note bubbles are not exposed by Agent Platform v1.

## Errors and retries

The SDK exposes typed errors:

```ts
import {
  AuthenticationError,
  ForbiddenError,
  PollReplacedError,
  RateLimitError,
  ServerError,
} from "whatsapp-agent-sdk";
```

All API errors expose the HTTP status, WhatsApp error code, details, trace ID, and raw response when available.

Safe retry behavior matters for sending:

- `429` rate limits are retried with backoff.
- Explicit `503 / 131016` "not accepted for delivery" errors are retryable.
- A `500`, connection reset, or timeout after `POST /messages` can have an **unknown send outcome**. The SDK does **not** automatically retry those sends by default because doing so can duplicate a message.
- Set `retrySendOnServerError: true` only if duplicate delivery is acceptable.

## Disable built-in rate limiting

The SDK rate-limits itself by default.

```ts
const client = new WhatsAppAgentClient({
  token,
  rateLimit: false,
});
```

This is mainly useful for tests or when a higher-level application already coordinates the API budgets.

## Privacy and security

Agent Platform chats are **not considered end-to-end encrypted** by WhatsApp because Meta operates infrastructure on behalf of the third-party agent. Your normal WhatsApp chats remain separate from the agent.

Treat the agent API key like a password:

- keep it server-side;
- use environment variables or a secrets manager;
- never ship it in frontend/browser bundles;
- never include it in logs;
- rotate it if it is exposed.

See [SECURITY.md](./SECURITY.md) for project-specific guidance and WhatsApp's official Third-Party Agent Terms for platform privacy details.

## API reference

See **[docs/API.md](./docs/API.md)** for constructor options, every method, accepted media formats, error classes, and endpoint mapping.

## Examples

- [`examples/send-message.ts`](./examples/send-message.ts) — proactive text send.
- [`examples/echo-agent.ts`](./examples/echo-agent.ts) — long-poll and reply loop.
- [`examples/send-media.ts`](./examples/send-media.ts) — image/document uploads.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## Official resources

- WhatsApp Agent Platform Developer Manual: https://www.whatsapp.com/developer/WhatsApp-Agent-Platform-Developer-Manual.pdf
- WhatsApp Help Center — third-party agents: https://faq.whatsapp.com/1050934623978152
- Third-Party Agent Terms: https://www.whatsapp.com/legal/third-party-agents-terms

## License

MIT.

WhatsApp is a trademark of WhatsApp LLC. Meta is a trademark of Meta Platforms, Inc. This project is independent and is not affiliated with, endorsed by, sponsored by, or maintained by WhatsApp or Meta.

