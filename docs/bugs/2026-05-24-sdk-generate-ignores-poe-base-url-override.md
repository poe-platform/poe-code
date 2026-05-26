# SDK generate ignores configured Poe base URL override

## Summary

The public SDK `generate()` function ignores the configured `POE_BASE_URL` environment variable used by the rest of Poe configuration and sends requests to the default Poe API endpoint unless a separate `POE_API_BASE_URL` variable is set.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: built public SDK entrypoint with stubbed `fetch`, an environment Poe API key, and no external network request

## Reproduction

From the repository root, run one SDK generation request while setting the configured Poe endpoint environment variable:

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
    String(url) + ' auth=' + (headers.get('authorization') ?? '<none>') + '\n'
  );
  return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

process.env.POE_API_KEY = 'env-key';
process.env.POE_BASE_URL = 'https://configured.example.invalid/v1';
delete process.env.POE_API_BASE_URL;

await generate('hello', { model: 'test-model' });
EOF_PROBE
FETCH_LOG="$probe/fetch.log" node "$probe/probe.mjs"
cat "$probe/fetch.log"
```

## Observed Behavior

The generated request ignores `POE_BASE_URL` and goes to Poe's public default endpoint:

```text
https://api.poe.com/v1/chat/completions auth=Bearer env-key
```

## Expected Behavior

When `POE_BASE_URL=https://configured.example.invalid/v1` is set, the public SDK should send generation requests to:

```text
https://configured.example.invalid/v1/chat/completions auth=Bearer env-key
```

## Impact

- SDK consumers cannot rely on the same Poe endpoint override used by configured providers, OAuth/usage flows, or proxy-backed test and enterprise environments.
- Requests can bypass a user-configured gateway or proxy and be sent to Poe's default API endpoint instead.
- Applications need to discover and maintain a second, inconsistent environment variable only for SDK generation.

## Supporting Evidence

`src/services/config.ts` declares the Poe base URL environment input as `POE_BASE_URL`, and `src/cli/environment.ts` derives the CLI Poe API URL from `variables.POE_BASE_URL`. In contrast, `src/sdk/generate.ts` initializes its client only from `process.env.POE_API_BASE_URL`, then defaults to `https://api.poe.com/v1` when that separate name is unset.

## Suspected Area

SDK client initialization should use the same Poe endpoint resolution contract as the rest of the application, including the established `POE_BASE_URL` override, instead of requiring a generation-specific variable name.
