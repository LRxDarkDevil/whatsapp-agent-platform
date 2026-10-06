# Security

## Two different secrets

This server can use two separate bearer secrets:

1. `WHATSAPP_AGENT_TOKEN` — grants access to the WhatsApp Agent Platform agent.
2. `MCP_AUTH_TOKEN` — protects the self-hosted MCP HTTP endpoint.

Never use the WhatsApp token itself as the MCP access token. MCP clients do not need it.

## stdio

stdio is local by design, but any MCP host allowed to run this server can invoke the exposed WhatsApp tools. Configure MCP client permissions accordingly.

## HTTP

HTTP mode:

- requires `MCP_AUTH_TOKEN` with at least 24 characters;
- validates `Host` headers;
- validates browser `Origin` headers when present;
- refuses non-loopback binding without `MCP_ALLOWED_HOSTS`;
- should sit behind HTTPS when exposed beyond localhost.

Static bearer auth is suitable for private/self-hosted use. A public multi-user deployment should use OAuth or another real identity layer at the edge and maintain separate WhatsApp credentials per user/tenant.

## File I/O

File tools are disabled by default. If enabled, `WHATSAPP_AGENT_MCP_FILE_ROOT` is mandatory and paths are constrained to that root. The implementation resolves existing paths/parent directories and rejects symlink destinations so a simple symlink cannot bypass the configured root.

Still treat enabling filesystem tools as a meaningful expansion of agent permissions. Point the root at a dedicated media directory rather than a home directory or source tree.

## WhatsApp privacy

WhatsApp states that third-party agent chats are not considered end-to-end encrypted. Applications should disclose any additional AI/model providers or storage systems that receive message content.

Official terms: https://www.whatsapp.com/legal/third-party-agents-terms

## Secret handling

- Do not commit `.env`.
- Do not log Authorization headers.
- Do not expose `WHATSAPP_AGENT_TOKEN` as an MCP tool argument or resource.
- Rotate either token immediately if exposed.
