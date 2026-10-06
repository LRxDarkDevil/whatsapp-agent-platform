# WhatsApp Agent Platform community tools

Community tooling for WhatsApp's personal **Agent Platform API** (`/agent/v1`).

This workspace contains two independently publishable packages:

- [`whatsapp-agent-sdk`](./whatsapp-agent-sdk) — TypeScript/Node.js SDK for the Agent Platform API.
- [`whatsapp-agent-mcp`](./whatsapp-agent-mcp) — Model Context Protocol server that exposes the Agent Platform to MCP-compatible AI clients.

Both projects are independent community projects and are not affiliated with, endorsed by, sponsored by, or maintained by WhatsApp or Meta.

## Workspace layout

```text
whatsapp-agent-platform/
├── whatsapp-agent-sdk/   # npm SDK
└── whatsapp-agent-mcp/   # MCP server package
```

## Validate everything

```bash
npm install
npm audit
npm run check
```

## Publishing

Both package names were unclaimed when last checked on 2026-10-05. Publish in this order because the MCP package depends on the SDK:

```bash
cd whatsapp-agent-sdk
npm publish

cd ../whatsapp-agent-mcp
npm publish
```

Each package includes its own `PUBLISHING.md` with the final checklist. Add your GitHub repository metadata to both package manifests after creating the public repository.

## Development

```bash
npm install
npm run check
```

The parent is an npm workspace, so `whatsapp-agent-mcp` uses the local SDK while developing and testing.

## Which package should I use?

- Use **`whatsapp-agent-sdk`** when you are writing Node/TypeScript code directly against WhatsApp's Agent Platform.
- Use **`whatsapp-agent-mcp`** when you want an MCP-compatible AI client to call WhatsApp Agent Platform tools through local stdio or self-hosted Streamable HTTP.

When publishing, publish `whatsapp-agent-sdk` first and `whatsapp-agent-mcp` second because the MCP package depends on the SDK.
