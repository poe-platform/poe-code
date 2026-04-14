# Development

## Run locally

- Run `npm run dev -- <command>` to invoke the CLI without rebuilding:

## Install local package

Install a locally-built version globally, mimicking a real npm release:

```bash
npm run install-local-package
```

Verify it worked with `poe-code --version` — local builds show a ` local build ` badge.

## E2E testing

Requires a valid API key plus the selected backend prerequisites. Local runs default to `sandbox`; CI defaults to `env`. Override with `E2E_BACKEND=env|sandbox|podman`.

```bash
npm run e2e           # Quiet mode - shows progress and summary
npm run e2e:verbose   # Verbose mode - shows all output
```

Additional commands:
- `npm run e2e:cleanup` - Backend-aware cleanup for podman artifacts and local cache
- `npm run e2e:cache:clear` - Clear the local e2e cache if dependencies seem stale

The e2e runner caches downloads at `~/.cache/poe-e2e`. See `docs/development/e2e.md` for backend details and prerequisites.

## Use different base_url

`POE_BASE_URL=<http://localhost:8000/__proxy__/poe/v1> npx poe-code@latest configure claude`
