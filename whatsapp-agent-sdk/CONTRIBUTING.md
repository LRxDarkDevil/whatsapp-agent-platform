# Contributing

Contributions are welcome once the repository is public.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Before opening a pull request:

1. Add or update tests for protocol behavior.
2. Keep the package free of real API keys, WhatsApp user IDs, private messages, and media.
3. Preserve raw response fields where practical so the SDK remains forward-compatible.
4. Do not silently change retry semantics for `POST /messages`; ambiguous failures can duplicate messages.
5. Update `CHANGELOG.md` for externally visible changes.

## Protocol changes

When the WhatsApp Agent Platform manual changes, cite the manual version/date in the pull request and update limits, types, tests, and docs together.

