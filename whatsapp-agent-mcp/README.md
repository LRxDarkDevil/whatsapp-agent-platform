# whatsapp-agent-mcp

Community **Model Context Protocol (MCP) server** for WhatsApp's personal Agent Platform API (`/agent/v1`). It lets MCP-compatible AI clients use your private WhatsApp agent through standard MCP tools without exposing the WhatsApp Agent API key to the model.

> **Community project.** This is not an official WhatsApp, Meta, or Model Context Protocol package and is not affiliated with, endorsed by, sponsored by, or maintained by those organizations.

## What it does

The server wraps the `whatsapp-agent-sdk` package and exposes safe MCP tools for:

- checking Agent Platform connectivity;
- reading retained messages/status updates;
- sending text and quoted replies;
- marking inbound messages read / showing typing;
- sending previously uploaded image/audio/video/document/sticker media IDs;
- reading media metadata;
- optional, sandboxed local media upload/download.

It also exposes `whatsapp-agent://capabilities`, an MCP resource describing the current Agent Platform constraints.

## MCP standard support

This package uses the current MCP TypeScript SDK v2 and follows the **2026-07-28** protocol architecture:

- **stdio** for local MCP clients using `serveStdio()`;
- **Streamable HTTP** for self-hosting using `createMcpHandler()`;
- the HTTP endpoint keeps the SDK's default stateless fallback for 2025-era MCP clients;
- the old HTTP+SSE transport is not used.

## Requirements

- Node.js **20+**.
- WhatsApp's **Agents** feature on your account.
- A WhatsApp Agent Platform API key.

Create the key inside WhatsApp from the agent's chat info. Keep it server-side.

## Install

You normally do not need a global install:

```bash
npx -y whatsapp-agent-mcp
```

Or install it into a project/server:

```bash
npm install whatsapp-agent-mcp
```

## Local MCP server — stdio

stdio is the default and simplest mode. The MCP host launches the server as a child process.

Required environment variable:

```bash
WHATSAPP_AGENT_TOKEN=your_agent_api_key
```

Then run:

```bash
npx -y whatsapp-agent-mcp
```

Do **not** print ordinary logs to stdout when wrapping this package; stdout is the MCP JSON-RPC transport. This package only reports CLI/server diagnostics to stderr.

### Generic MCP client configuration

```json
{
  "mcpServers": {
    "whatsapp-agent": {
      "command": "npx",
      "args": ["-y", "whatsapp-agent-mcp"],
      "env": {
        "WHATSAPP_AGENT_TOKEN": "${WHATSAPP_AGENT_TOKEN}"
      }
    }
  }
}
```

Different MCP hosts use slightly different top-level configuration keys, but the command/args/env model is standard for stdio servers. See [`examples/client-configs.md`](./examples/client-configs.md).

## Self-hosted MCP server — Streamable HTTP

Set:

```bash
WHATSAPP_AGENT_MCP_TRANSPORT=http
WHATSAPP_AGENT_TOKEN=your_whatsapp_agent_api_key
MCP_AUTH_TOKEN=generate_a_separate_long_random_secret
HOST=127.0.0.1
PORT=3000
```

Then:

```bash
npx -y whatsapp-agent-mcp
```

Endpoints:

- MCP: `http://127.0.0.1:3000/mcp`
- Health: `http://127.0.0.1:3000/health`

Connect with:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

`MCP_AUTH_TOKEN` is deliberately separate from `WHATSAPP_AGENT_TOKEN`. MCP clients should **never receive the WhatsApp Agent API key**.

### Public hosting

For anything beyond localhost:

```bash
HOST=0.0.0.0
MCP_ALLOWED_HOSTS=mcp.example.com
MCP_ALLOWED_ORIGINS=mcp.example.com
```

The server refuses non-loopback binding when `MCP_ALLOWED_HOSTS` is missing. Use HTTPS at your reverse proxy/load balancer.

Static bearer authentication is intended for private/self-hosted deployments. If you operate a public multi-user MCP service, use proper OAuth/resource-server authentication at the edge and isolate WhatsApp credentials per authenticated user rather than sharing one global Agent API key.

## Available tools

| Tool | Effect |
|---|---|
| `whatsapp_agent_status` | Non-consuming connection/status probe |
| `whatsapp_get_updates` | Read retained Agent Platform messages/statuses |
| `whatsapp_send_text` | Send text to the agent creator |
| `whatsapp_mark_read` | Mark inbound message read, optionally show typing |
| `whatsapp_send_media` | Send an existing Agent Platform media ID |
| `whatsapp_get_media` | Read media metadata |

### Optional file tools

Local filesystem tools are **off by default**. Enable them only when you intentionally want an AI client to interact with a restricted media directory:

```bash
WHATSAPP_AGENT_MCP_ALLOW_FILE_IO=true
WHATSAPP_AGENT_MCP_FILE_ROOT=/safe/agent-media
```

This adds:

- `whatsapp_upload_media_file`
- `whatsapp_download_media_file`

Both tools enforce that paths stay inside `WHATSAPP_AGENT_MCP_FILE_ROOT`. They cannot intentionally traverse outside it with `../` or absolute paths pointing elsewhere.

## Tool behavior worth knowing

### `whatsapp_get_updates`

```json
{
  "offset": "0",
  "limit": 50,
  "timeoutSeconds": 0
}
```

`nextOffset` is returned as an exact decimal **string**. Pass it back unchanged. Polling itself does not mark messages read.

Only run one long poll at a time per WhatsApp Agent API key. A newer poll replaces an older one at the Agent Platform level.

### `whatsapp_send_text`

```json
{
  "text": "Hello from my MCP-connected agent",
  "previewUrl": false,
  "replyTo": "optional-wamid"
}
```

The Agent Platform currently only permits the agent to message its creator. This MCP server intentionally does not expose a `to` phone-number parameter.

### `whatsapp_mark_read`

```json
{
  "messageId": "wamid...",
  "typing": true
}
```

Marking a message read removes that inbound message from the Agent Platform's replayable retained buffer. Process important data before marking it read.

## Privacy/security model

- Your WhatsApp Agent API key stays in the MCP server's environment.
- Tool responses deliberately do not expose the authenticated media download URL.
- File access is disabled unless explicitly enabled and rooted to one directory.
- Hosted mode requires a separate bearer token.
- Hosted mode validates Host and Origin headers.
- Agent tools cannot access your unrelated WhatsApp chats.
- WhatsApp states that third-party agent chats are **not considered end-to-end encrypted** because Meta operates infrastructure on behalf of the agent.

See [`SECURITY.md`](./SECURITY.md).

## Programmatic use

You can embed the server factory:

```ts
import { createWhatsAppAgentMcpServer } from "whatsapp-agent-mcp";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const token = process.env.WHATSAPP_AGENT_TOKEN!;

serveStdio(() => createWhatsAppAgentMcpServer({ token }));
```

Or launch the built-in HTTP server:

```ts
import { startHttpServer } from "whatsapp-agent-mcp";

await startHttpServer({
  whatsappToken: process.env.WHATSAPP_AGENT_TOKEN!,
  authToken: process.env.MCP_AUTH_TOKEN!,
  host: "127.0.0.1",
  port: 3000,
});
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## Publishing order

`whatsapp-agent-mcp` depends on `whatsapp-agent-sdk`. Publish the SDK first, then this package. See [`PUBLISHING.md`](./PUBLISHING.md).

## Related official docs

- MCP TypeScript SDK v2: https://ts.sdk.modelcontextprotocol.io/v2/
- WhatsApp Agent Platform Developer Manual: https://www.whatsapp.com/developer/WhatsApp-Agent-Platform-Developer-Manual.pdf
- WhatsApp Third-Party Agent Terms: https://www.whatsapp.com/legal/third-party-agents-terms

## License

MIT.

WhatsApp is a trademark of WhatsApp LLC. Meta is a trademark of Meta Platforms, Inc. Model Context Protocol is an open protocol. This project is independent and not affiliated with WhatsApp or Meta.
