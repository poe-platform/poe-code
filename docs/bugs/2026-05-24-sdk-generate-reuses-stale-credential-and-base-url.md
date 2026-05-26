# SDK generate reuses stale credential and base URL across calls

## Summary

Calling the public SDK `generate()` function more than once in the same process reuses the first Poe API key and `POE_API_BASE_URL`, even after the caller updates both environment values before a later generation request.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: built public SDK entrypoint with a disposable Node.js probe and stubbed `fetch` recording request destinations and authorization headers

## Reproduction

From the repository root, run two SDK generations in one process while changing the documented SDK endpoint override and credential between calls:

```sh
repo=$PWD
probe=$(mktemp -d)
cat > "$probe/probe.mjs" <<EOF_PROBE
import fs from 'node:fs';
import { generate } from '$repo/dist/index.js';

globalThis.fetch = async (url, init = {}) => {
  const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers ?? {});
  fs.appendFileSync(
    process.env.FETCH_LOG,
    String(url) + ' auth=' + (headers.get('authorization') ?? '<none>') + '\\n'
  );
  return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

process.env.POE_API_KEY = 'first-key';
process.env.POE_API_BASE_URL = 'https://first.example.invalid/v1';
await generate('first prompt', { model: 'test-model' });

process.env.POE_API_KEY = 'second-key';
process.env.POE_API_BASE_URL = 'https://second.example.invalid/v1';
await generate('second prompt', { model: 'test-model' });
EOF_PROBE
FETCH_LOG="$probe/fetch.log" node "$probe/probe.mjs"
cat "$probe/fetch.log"
```

## Observed Behavior

Both requests use the first call's route and credential:

```text
https://first.example.invalid/v1/chat/completions auth=Bearer first-key
https://first.example.invalid/v1/chat/completions auth=Bearer first-key
```

The second call ignores `POE_API_KEY=second-key` and `POE_API_BASE_URL=https://second.example.invalid/v1` even though those values are set before invoking `generate()` again.

## Expected Behavior

Each public SDK generation call should resolve the currently configured Poe credential and documented `POE_API_BASE_URL`, or the SDK should expose an explicit scoped client lifecycle that prevents unrelated later calls from silently using stale authentication and routing state.

## Impact

- Long-running services cannot rotate Poe credentials safely without restarting the process.
- Multi-tenant or test code can send a later caller's prompt through an earlier caller's credential and endpoint.
- Endpoint changes intended to move traffic to another gateway, test server, or environment are silently ignored after the first SDK generation.

## Supporting Evidence

`src/sdk/generate.ts` calls `getGlobalClient()` before resolving a credential or endpoint; only the first call reaches `getPoeApiKey()` and `process.env.POE_API_BASE_URL`. `src/services/client-instance.ts` stores the resulting `LlmClient` in module-level `globalClient`, and `initializeClient(...)` explicitly returns without replacing it once initialized. The SDK documentation identifies `POE_API_BASE_URL` as the endpoint input used by SDK generation functions, but later calls never re-evaluate it.

## Suspected Area

SDK generation should avoid an implicit process-wide authenticated client cache, or should key and refresh cached clients whenever active credential or endpoint configuration changes.
