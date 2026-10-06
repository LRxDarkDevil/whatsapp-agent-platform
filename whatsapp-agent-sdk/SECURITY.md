# Security

## API keys

The WhatsApp Agent Platform API key is a bearer secret. Anyone who obtains it may be able to operate that agent within the platform's permissions.

- Keep it on a trusted server/device.
- Use environment variables or a secrets manager.
- Never commit it to source control.
- Never put it in a URL/query string.
- Never expose it in browser/client-side JavaScript.
- Never log the `Authorization` header.
- Regenerate/rotate the key if it is exposed.

This repository intentionally contains no real API key.

## Agent message privacy

WhatsApp states that conversations with third-party agents are not considered end-to-end encrypted because Meta manages the service on behalf of the agent. Applications using this SDK should clearly disclose their own data handling and any model/provider that receives message or media content.

Official terms: https://www.whatsapp.com/legal/third-party-agents-terms

## Media downloads

Media URLs returned by the authenticated API require bearer authorization. The SDK sets `redirect: "error"` for these downloads so an authorization header is not intentionally forwarded to a redirect destination.

## Reporting a vulnerability

Before the project has a public repository security channel, report vulnerabilities privately to the repository maintainer rather than opening an issue containing secrets or exploit details.

