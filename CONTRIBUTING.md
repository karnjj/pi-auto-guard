# Contributing

Keep changes focused and explain the safety behavior they introduce or modify. Policy changes should include examples of both permitted and blocked behavior.

## Development

```bash
npm ci
npm run check
```

Every behavior change should include a regression test. Avoid adding runtime dependencies when the same behavior can be implemented with Pi's bundled packages or Node.js built-ins.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Releasing

Releases are tag-driven and must be created from `main`. Update the package version and create its matching tag with npm, then push both:

```bash
npm version patch
git push origin main --follow-tags
```

Use `minor` or `major` instead of `patch` when appropriate. The `release.yml` workflow verifies the tag, runs all checks, publishes through npm trusted publishing, and creates the GitHub Release.
