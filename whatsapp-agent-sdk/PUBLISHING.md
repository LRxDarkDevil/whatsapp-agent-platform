# Publishing checklist

The package is currently named `whatsapp-agent-sdk` and was not found on npm when this project was prepared on 2026-10-05. npm names are first-come, first-served, so re-check immediately before publishing.

## 1. Create the public repository

Before publishing, add your repository metadata to `package.json`, for example:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/YOUR_USERNAME/whatsapp-agent-sdk.git"
  },
  "bugs": {
    "url": "https://github.com/YOUR_USERNAME/whatsapp-agent-sdk/issues"
  },
  "homepage": "https://github.com/YOUR_USERNAME/whatsapp-agent-sdk#readme"
}
```

Do not add a real Agent Platform API key to the repository.

## 2. Final validation

```bash
npm install
npm audit
npm run check
npm pack --dry-run
npm view whatsapp-agent-sdk name
```

For the last command, an npm `E404` means the package name is still unclaimed.

## 3. Publish

```bash
npm login
npm publish
```

`prepack` automatically runs type checking, tests, and the build before npm creates the publish tarball.

## 4. Tag the source release

```bash
git tag v0.1.0
git push origin main --tags
```

Create a GitHub release from `CHANGELOG.md` if desired.

## Future releases

Use semantic versioning:

```bash
npm version patch   # bug fix
npm version minor   # backward-compatible feature
npm version major   # breaking API change
```

Update `CHANGELOG.md` before publishing each version.
