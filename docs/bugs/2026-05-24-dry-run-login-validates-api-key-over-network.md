# Dry-run login validates the supplied API key over the network

## Summary

Running `login --api-key` with the root `--dry-run` option still sends the supplied Poe API key to Poe's current-balance authentication endpoint.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a preload `fetch` recorder

## Reproduction

From the repository root, run `login` under dry-run while intercepting its outbound authentication validation request:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"opencode":{"provider":"poe","apiShape":"openai-chat-completions","files":[]}}}
EOF
cat > "$probe/fetch-preload.mjs" <<'EOF'
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(process.env.FETCH_LOG, `${String(url)} ${init.method ?? 'GET'} ${init.headers?.Authorization ?? ''}\n`);
  return new Response(JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }), {
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
    "$repo/src/index.ts" --dry-run --yes login --api-key 'probe-new-key'
)
cat "$probe/fetch.log"
find "$probe/home" -type f -print | sort
```

## Observed Behavior

- The CLI prints `Dry run: would save API key.` and reports no filesystem changes.
- The fetch recorder logs `https://api.poe.com/usage/current_balance GET Bearer probe-new-key`.
- The supplied API key is therefore transmitted through an authentication request even though dry-run is enabled.

## Expected Behavior

With root `--dry-run`, `login --api-key` must not transmit the provided credential over the network. It should preview credential storage and any dependent reconfiguration without validating a live secret remotely.

## Impact

- A command presented as a simulation exposes a newly supplied secret to an external service.
- Users cannot safely preview login or dependent configuration behavior with placeholder or production credentials.
- Automated dry-run checks can perform unintended authenticated network activity.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/login.ts`, `executeLogin(...)` passes the supplied key to `container.options.resolveApiKey(...)` before printing its dry-run completion. In `src/cli/options.ts`, any provided `input.value` is passed to `validateApiKey(...)`, which delegates through `src/cli/container.ts` to `checkAuth(...)`. In `packages/poe-oauth/src/check-auth.ts`, `checkAuth(...)` sends a `GET` request to `https://api.poe.com/usage/current_balance` with `Authorization: Bearer <apiKey>`.

## Suspected Area

Dry-run login should avoid remote API-key validation, or explicitly separate validation from a simulation mode that promises no externally observable actions.
