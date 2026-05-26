# SDK runRalph E2B failure exports stored Poe credential into process environment

## Summary

Calling the public SDK `runRalph()` function with reusable E2B execution enabled copies the stored Poe credential into the caller's `process.env.POE_API_KEY` before it rejects a plan containing an invalid agent, even though no E2B session or agent can be launched.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: built public SDK entrypoint with a disposable home/project directory, locally stored Poe login, stubbed login validation request, and no external runtime launch

## Reproduction

From the repository root, create a stored Poe credential and a disposable Ralph plan containing an invalid agent, then call the SDK through its reusable E2B path:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code/ralph/plans"
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
    "$repo/src/index.ts" --yes login --api-key stored-ralph-key >/dev/null
)
cat > "$probe/project/.poe-code/ralph/plans/plan.md" <<'EOF_PLAN'
---
agent: not-a-real-agent
iterations: 1
---
Hello
EOF_PLAN
cat > "$probe/ralph-probe.mjs" <<EOF_PROBE
import { runRalph } from '$repo/dist/index.js';

delete process.env.POE_API_KEY;
try {
  await runRalph({
    cwd: '$probe/project',
    homeDir: '$probe/home',
    docPath: '.poe-code/ralph/plans/plan.md',
    runtime: 'e2b'
  });
} catch (error) {
  console.log('error=' + (error instanceof Error ? error.message : String(error)));
}
console.log('env=' + (process.env.POE_API_KEY ?? '<unset>'));
EOF_PROBE
HOME="$probe/home" node "$probe/ralph-probe.mjs"
```

## Observed Behavior

The invalid Ralph SDK request rejects, but the stored secret has already been copied into the caller process environment:

```text
error=Unknown agent "not-a-real-agent".
env=stored-ralph-key
```

The invalid agent fails while constructing its spawn arguments, before any reusable E2B session is opened.

## Expected Behavior

A failed SDK Ralph request should validate the agent before importing a stored credential into mutable process-global state. When the plan cannot execute because its agent is invalid, `process.env.POE_API_KEY` should remain unset.

## Impact

- Applications that validate or attempt an invalid E2B Ralph run unexpectedly gain a long-lived plaintext secret in process-global environment state.
- Later unrelated code and child processes can inherit the stored Poe credential after an operation that failed before opening any E2B execution session.
- This is a separate public SDK path from `spawn()`: Ralph's reusable E2B runner performs its own credential export before `buildSpawnArgs()` validation.

## Supporting Evidence

In `src/sdk/ralph.ts`, `runRalph()` selects `createReusableE2bRalphRunner()` whenever `runtime: "e2b"` is used without detach mode. Its `runAgent()` invokes `ensurePoeApiKey()` before `buildSpawnArgs(input.agent, ...)`; `ensurePoeApiKey()` assigns the stored value to `process.env.POE_API_KEY`. For an unknown agent, `buildSpawnArgs()` then throws `Unknown agent`, leaving the earlier global credential mutation in place.

## Suspected Area

The reusable E2B Ralph runner should validate and construct the requested agent invocation before placing credentials in execution-scoped environment state, and should avoid mutating the embedding application's global environment.
