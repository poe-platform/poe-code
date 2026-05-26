# SDK spawn failure exports stored Poe credential into process environment

## Summary

Calling the public SDK `spawn()` function for an invalid agent mutates the caller's `process.env.POE_API_KEY` with the stored Poe credential before rejecting the invalid request, even though no agent can be launched.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: built public SDK entrypoint with a disposable home/project directory, locally stored Poe login, stubbed login validation request, and no spawned external agent process

## Reproduction

From the repository root, create a stored Poe credential in a disposable home, then call the SDK with an agent id that cannot be executed:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF_FETCH'
globalThis.fetch = async (url) => String(url).includes('/usage/current_balance')
  ? new Response(JSON.stringify({ current_point_balance: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  : new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
EOF_FETCH
(
  cd "$probe/project" &&
  HOME="$probe/home" NODE_OPTIONS="--import=$probe/fetch-preload.mjs" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes login --api-key stored-sdk-key >/dev/null
)
cat > "$probe/spawn-probe.mjs" <<EOF_PROBE
import { spawn } from '$repo/dist/index.js';

delete process.env.POE_API_KEY;
const { result } = spawn('not-a-real-agent', {
  prompt: 'hello',
  cwd: '$probe/project'
});
try {
  await result;
} catch (error) {
  console.log('error=' + (error instanceof Error ? error.message : String(error)));
}
console.log('env=' + (process.env.POE_API_KEY ?? '<unset>'));
EOF_PROBE
HOME="$probe/home" node "$probe/spawn-probe.mjs"
```

## Observed Behavior

The invalid SDK request rejects, but the stored secret has already been copied into the caller process environment:

```text
error=Unknown service "not-a-real-agent".
env=stored-sdk-key
```

No valid agent id was supplied and no external agent process is required to reproduce the mutation.

## Expected Behavior

A failed SDK spawn request should validate the requested agent before importing stored credentials into mutable process-global state. When an invalid agent cannot execute, `process.env.POE_API_KEY` should remain unset.

## Impact

- Applications that merely validate or attempt an invalid SDK spawn unexpectedly gain a long-lived plaintext secret in process-global environment state.
- Later unrelated code and child processes can inherit the stored Poe credential after an operation that failed before launching an agent.
- Error handling cannot assume unsuccessful SDK calls are free of credential side effects.

## Supporting Evidence

In `src/sdk/spawn.ts`, the SDK resolves `getPoeApiKey()` and writes `process.env.POE_API_KEY = resolvedApiKey` before it resolves the requested service through the configured spawn path. For an unknown service, validation fails later with `Unknown service`, leaving the earlier process-global credential mutation in place.

## Suspected Area

SDK spawn should resolve and validate the target service before exposing any credential to child-process environment handling, and should pass credentials in scoped child execution state rather than mutating the caller's global environment.
