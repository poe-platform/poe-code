# Poe credential validation ignores Poe base URL override

## Summary

Running `login --api-key`, `provider login poe --api-key`, or inline `configure --provider poe --api-key` with `POE_BASE_URL` configured still transmits the supplied credential to the default Poe authentication endpoint rather than validating it through the configured Poe base URL.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stubbed `fetch` recording request destinations and authorization headers

## Reproduction

From the repository root, run Poe credential-accepting setup commands with a Poe endpoint override and compare an account-read command using the same override:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF_FETCH'
import fs from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers ?? {});
  fs.appendFileSync(
    process.env.FETCH_LOG,
    `${String(url)} auth=${headers.get('authorization') ?? '<none>'}\n`
  );
  if (String(url).includes('/usage/current_balance')) {
    return new Response(JSON.stringify({ current_point_balance: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(
    JSON.stringify({ user_id: 1, handle: 'probe', name: 'Probe', profile_picture: '' }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};
EOF_FETCH
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/login.log" \
  POE_BASE_URL=https://gateway.example.invalid/v1 \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes login --api-key supplied-secret
)
cat "$probe/login.log"
(
  cd "$probe/project" &&
  HOME="$probe/provider-home" FETCH_LOG="$probe/provider-login.log" \
  POE_BASE_URL=https://gateway.example.invalid/v1 \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes provider login poe --api-key provider-secret
)
cat "$probe/provider-login.log"
(
  cd "$probe/project" &&
  HOME="$probe/configure-home" FETCH_LOG="$probe/configure.log" \
  POE_BASE_URL=https://gateway.example.invalid/v1 \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes configure codex --provider poe \
      --api-key inline-configure-secret --model openai/gpt-5.5
)
cat "$probe/configure.log"
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/whoami.log" \
  POE_BASE_URL=https://gateway.example.invalid/v1 POE_API_KEY=environment-secret \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" auth whoami
)
cat "$probe/whoami.log"
```

## Observed Behavior

- `POE_BASE_URL=https://gateway.example.invalid/v1 poe-code --yes login --api-key supplied-secret` exits successfully but sends `supplied-secret` to `https://api.poe.com/usage/current_balance`.
- `provider login poe --api-key provider-secret` likewise validates `provider-secret` at `https://api.poe.com/usage/current_balance` under the configured Poe base URL override.
- `configure codex --provider poe --api-key inline-configure-secret ...` likewise validates `inline-configure-secret` at `https://api.poe.com/usage/current_balance` before applying configuration.
- Under the same Poe base URL override, `auth whoami` sends its environment credential to `https://gateway.example.invalid/v1/whoami`.
- Poe setup-time credential validation therefore bypasses the active endpoint configuration while other authenticated account reads honor it.

## Expected Behavior

When a Poe base URL is configured, every Poe setup command that validates a supplied credential should validate against the configured Poe endpoint, consistently with authenticated account operations and without transmitting the credential to a different default destination.

## Impact

- Users targeting a proxy, test server, gateway, or enterprise Poe-compatible endpoint cannot safely log in through that route.
- A secret intended for a configured endpoint is silently transmitted to the default Poe host during login validation.
- Login, provider setup, agent configuration, and subsequent authenticated commands use inconsistent endpoint routing.

## Supporting Evidence

In `src/cli/container.ts`, the shared option resolver is constructed with `checkAuth: async (apiKey) => (await checkAuth({ apiKey })) !== null`, omitting `environment.poeBaseUrl`. `src/cli/commands/login.ts`, `src/cli/commands/provider.ts`, and Poe inline-login handling in `src/cli/commands/configure.ts` all reach that resolver. In `packages/poe-oauth/src/check-auth.ts`, absence of a `baseUrl` option defaults validation to `https://api.poe.com`. By contrast, `src/cli/commands/auth.ts` builds `whoami` requests from `container.env.poeApiBaseUrl`, which derives from `POE_BASE_URL`.

## Suspected Area

Credential validation for Poe setup commands should receive the active Poe base URL from the CLI environment, ensuring setup and subsequent authenticated requests use one endpoint policy.
