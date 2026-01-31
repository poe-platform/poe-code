# Development

## Run locally

- Run `npm run dev -- <command>` to invoke the CLI without rebuilding:

## E2E testing

Requires Docker (or Podman) and a valid API key.

```bash
npm run e2e           # Quiet mode - shows progress and summary
npm run e2e:verbose   # Verbose mode - shows all output
```

Additional commands:
- `npm run e2e:cleanup` - Clean up orphaned containers
- `npm run e2e:logs` - View test logs
- `npm run e2e:logs:rotate` - Rotate old log files
- `npm run e2e:cache:clear` - Clear npm cache volume (if dependencies seem stale)

The e2e runner caches npm downloads at `~/.cache/poe-e2e/npm`.

## Use different base_url

`POE_BASE_URL=<http://localhost:8000/__proxy__/poe/v1> npx poe-code@latest configure claude`
