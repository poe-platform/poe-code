# Development

## Run locally

- Run `bun run dev -- <command>` to invoke the CLI without rebuilding:

## Install local package

Install a locally-built version globally, mimicking a real registry release:

```bash
bun run install-local-package
```

Verify it worked with `poe-code --version` — local builds show a ` local build ` badge.

## E2E testing

Requires Docker (or Podman) and a valid API key.

```bash
bun run e2e           # Quiet mode - shows progress and summary
bun run e2e:verbose   # Verbose mode - shows all output
```

Additional commands:
- `bun run e2e:cleanup` - Clean up orphaned containers
- `bun run e2e:logs` - View test logs
- `bun run e2e:logs:rotate` - Rotate old log files
- `bun run e2e:cache:clear` - Clear Bun cache volume (if dependencies seem stale)

The e2e runner caches Bun downloads at `~/.cache/poe-e2e/bun`.

## Use different base_url

`POE_BASE_URL=<http://localhost:8000/__proxy__/poe/v1> npx poe-code@latest configure claude`
