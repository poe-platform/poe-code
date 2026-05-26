# Models ignores Poe environment credential and fetches anonymously

## Summary

Running `models` with `POE_API_KEY` set ignores the active environment credential and sends the model-catalog request without an `Authorization` header.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stubbed `fetch` recording request authentication headers

## Reproduction

From the repository root, provide a Poe environment credential and record the outgoing model request:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(
    process.env.FETCH_LOG,
    `${String(url)} auth=${init.headers?.Authorization ?? '<none>'}\n`
  );
  return new Response(JSON.stringify({ object: 'list', data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
EOF
(
  cd "$probe/project" &&
  FETCH_LOG="$probe/fetch.log" HOME="$probe/home" POE_API_KEY=environment-models-key \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes models
)
cat "$probe/fetch.log"
```

## Observed Behavior

- `models` exits successfully after displaying `0 models fetched` and `No models found.`.
- The fetch recorder captures `https://api.poe.com/v1/models auth=<none>` despite `POE_API_KEY=environment-models-key` being present for the command.
- The active environment authentication is not used to query the model catalog.

## Expected Behavior

When `POE_API_KEY` is set, `models` should authenticate the Poe model-catalog request consistently with other Poe API reads, or explicitly document and report that it intentionally performs an anonymous catalog request.

## Impact

- Users may receive an incomplete or different model catalog from the one available to their authenticated account.
- Environment-authenticated automation silently makes anonymous requests while appearing to operate under the supplied account credential.
- Poe authentication handling is inconsistent across account-backed read commands.

## Supporting Evidence

In `src/cli/commands/models.ts`, the command calls `container.readApiKey()` and adds an `Authorization` header only when that stored-key lookup returns a value. It does not consult `container.env.getVariable("POE_API_KEY")` or the shared environment-aware credential resolver, so an environment-only authenticated session is treated as anonymous.

## Suspected Area

Models should resolve Poe authentication through the same environment-aware path used by authenticated account commands before constructing its API request headers.
