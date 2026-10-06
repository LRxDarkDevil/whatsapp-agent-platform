# Publishing checklist

The package name `whatsapp-agent-mcp` was not found on npm when prepared on 2026-10-05. npm names are first-come, first-served, so re-check immediately before publication.

## Publish dependency first

This package depends on:

```text
whatsapp-agent-sdk ^0.1.0
```

Publish `whatsapp-agent-sdk@0.1.0` before publishing this package.

## Add repository metadata

Once the public GitHub repository exists, add its `repository`, `bugs`, and `homepage` fields to `package.json`.

## Validate

From the workspace root:

```bash
npm install
npm audit
npm run check -w whatsapp-agent-mcp
npm pack --dry-run -w whatsapp-agent-mcp
npm view whatsapp-agent-mcp version
```

An npm `E404` on the final command means the name is still unclaimed.

## Publish

```bash
cd whatsapp-agent-mcp
npm login
npm publish
```

Do not publish any `.env`, API key, WhatsApp user identifier, or test transcript.

