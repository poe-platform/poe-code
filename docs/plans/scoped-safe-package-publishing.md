# Scoped SafeJS and Safe Bash publishing

## Packages

Publish `@poe-platform/safe-js` and `@poe-platform/safe-bash` without renaming
the private workspaces or depending on the `poe-code` CLI package.

Build distribution artifacts from the maintained workspace outputs. Preserve
relative worker modules and the complete public declaration graph. SafeJS
owns the shared filesystem under `@poe-platform/safe-js/fs`; Safe Bash depends
on the matching SafeJS version, preserving canonical filesystem identity.
Retain the browser shell entry and conditional portable filesystem exports.

## Delivery

- Validate artifact collection with memory-only unit tests.
- Install real tarballs together and exercise Node, Bun, TypeScript, and the
  browser bundle without workspace aliases or the CLI dependency.
- Bootstrap version 0.1.0 through terminal-pilot and npm browser approval.
- Configure npm trusted publishers for organization `poe-platform`, repository
  `poe-code`, workflow `release-safe.yml`, with no environment.
- Use GitHub Actions with OIDC and provenance for subsequent releases.
- Verify package settings and provenance in npm using Playwright CLI.
