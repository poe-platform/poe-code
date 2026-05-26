# Dry-run version checks the npm registry

## Summary

Running the global `--version` option together with root `--dry-run` still performs an HTTP request to the npm registry to check for updates.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a preload `fetch` recorder

## Reproduction

From the repository root, invoke the version preview while recording outbound fetch calls:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(process.env.FETCH_LOG, `${String(url)} ${init.method ?? 'GET'}\n`);
  return new Response(JSON.stringify({ "dist-tags": { "latest": "0.0.0" } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
EOF
(
  cd "$probe/project" &&
  FETCH_LOG="$probe/fetch.log" HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --version
)
cat "$probe/fetch.log"
```

## Observed Behavior

- The CLI prints its local version information.
- The fetch recorder logs `https://registry.npmjs.org/poe-code GET`.
- The network call occurs even though the invocation includes root `--dry-run`.

## Expected Behavior

With root `--dry-run`, displaying version information must not query the npm registry for update metadata. The command should render local version output only, or explicitly preview an update check without performing it.

## Impact

- A supposedly simulated invocation performs an unnecessary external request.
- Offline or policy-restricted environments can observe latency or network policy violations while only requesting previewed version output.
- Automated dry-run checks cannot assume the CLI avoids external access for global options.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/version.ts`, `displayVersion(...)` creates a logger with `dryRun: false` and always calls `checkForUpdate(...)` when `--version` is present, without inspecting root flags. In `src/services/version.ts`, `checkForUpdate(...)` issues `GET https://registry.npmjs.org/poe-code` through the HTTP client.

## Suspected Area

Version option handling should honor root dry-run before invoking update discovery.
