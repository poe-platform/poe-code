# Dry-run auth whoami still calls Poe API

## Summary

Running `auth whoami` with the root `--dry-run` option still makes an authenticated HTTP request to the configured Poe API endpoint.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable local HTTP recorder configured through `POE_BASE_URL`

## Reproduction

From the repository root, start a disposable local HTTP server that records requests and returns a mock identity, then run `auth whoami` in dry-run mode:

```sh
probe=$(mktemp -d)
cat > "$probe/server.mjs" <<'EOF'
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
const marker = process.env.MARKER;
const portFile = process.env.PORT_FILE;
const server = createServer((req, res) => {
  appendFileSync(marker, `${req.method} ${req.url}\n`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ user_id: 1, handle: 'probe', name: 'Probe', profile_picture: '' }));
});
server.listen(0, '127.0.0.1', () => writeFileSync(portFile, String(server.address().port)));
EOF
MARKER="$probe/requests" PORT_FILE="$probe/port" node "$probe/server.mjs" &
server_pid=$!
while [ ! -s "$probe/port" ]; do sleep 0.05; done
mkdir -p "$probe/home" "$probe/project"

(
  cd "$probe/project"
  HOME="$probe/home" POE_API_KEY=probe-key POE_BASE_URL="http://127.0.0.1:$(cat "$probe/port")" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run auth whoami
)

cat "$probe/requests"
kill "$server_pid"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command prints the JSON identity returned by the local server.
- The request marker records `POST /v1/whoami` despite root `--dry-run`.
- Supplying `POE_API_KEY` avoids credential persistence and isolates the issue to network execution during preview mode.

## Expected Behavior

With root `--dry-run`, `auth whoami` must not send authenticated HTTP requests. It should report that it would query the configured identity endpoint.

## Impact

- A preview can transmit authentication credentials to a configured endpoint.
- Dry-run may trigger network activity, server-side audit logs, rate limits, or endpoint side effects.
- Users cannot safely validate authentication command routing without performing a live request.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/auth.ts` checks dry-run in `auth status`, but `executeWhoami` accepts no command flags and immediately performs `container.httpClient(.../whoami)` after resolving a credential.

## Suspected Area

Authentication subcommands need consistent execution-flag handling before making network requests.
