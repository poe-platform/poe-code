# OAuth login ignores Poe base URL override during token exchange

## Summary

Running interactive `login` with `POE_BASE_URL` configured still exchanges the OAuth authorization code at the default Poe token endpoint rather than through the configured Poe base URL.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory, a fake browser opener, pasted OAuth code input, and stubbed `fetch` recording request destinations

## Reproduction

From the repository root, run the OAuth login flow with a gateway override while replacing browser launch and network traffic with local stubs:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project" "$probe/bin"
cat > "$probe/bin/open" <<'EOF_OPEN'
#!/bin/sh
printf '%s\n' "$*" >> "$OPEN_LOG"
exit 0
EOF_OPEN
chmod +x "$probe/bin/open"
cat > "$probe/fetch-preload.mjs" <<'EOF_FETCH'
import fs from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers ?? {});
  fs.appendFileSync(
    process.env.FETCH_LOG,
    `${String(url)} auth=${headers.get('authorization') ?? '<none>'} method=${init.method ?? 'GET'}\n`
  );
  if (String(url).includes('/token')) {
    return new Response(JSON.stringify({ api_key: 'oauth-issued-key', api_key_expires_in: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  if (String(url).includes('/usage/current_balance')) {
    return new Response(JSON.stringify({ current_point_balance: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ email: 'probe@example.test' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
EOF_FETCH
(
  cd "$probe/project" &&
  printf 'manual-authorization-code\n' | \
    HOME="$probe/home" FETCH_LOG="$probe/login.log" OPEN_LOG="$probe/open.log" \
    PATH="$probe/bin:$PATH" POE_BASE_URL=https://gateway.example.invalid/v1 \
    NODE_OPTIONS="--import=$probe/fetch-preload.mjs" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes login
)
cat "$probe/login.log"
cat "$probe/open.log"
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/usage.log" \
  POE_BASE_URL=https://gateway.example.invalid/v1 \
  NODE_OPTIONS="--import=$probe/fetch-preload.mjs" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes usage balance
)
cat "$probe/usage.log"
```

## Observed Behavior

- `POE_BASE_URL=https://gateway.example.invalid/v1 poe-code --yes login` opens the normal Poe authorization page but sends the pasted authorization code to `https://api.poe.com/token` using `POST`.
- The OAuth-issued credential is successfully stored, showing that this is the token-exchange request used by the login flow.
- Under the same base URL override and stored OAuth credential, `usage balance` calls `https://gateway.example.invalid/usage/current_balance`.
- OAuth acquisition therefore bypasses the active endpoint configuration even though subsequent Poe account traffic honors it.

## Expected Behavior

When a Poe base URL is configured, OAuth token exchange for a Poe login should use the corresponding configured Poe endpoint, consistently with subsequent authenticated Poe operations and without sending the authorization code to a different default destination.

## Impact

- Users targeting a proxy, test server, gateway, or enterprise Poe-compatible endpoint cannot complete OAuth login entirely through that route.
- An OAuth authorization code intended for the configured endpoint is silently transmitted to the default Poe host during login.
- OAuth login and post-login Poe requests use inconsistent endpoint routing under the same configured environment.

## Supporting Evidence

`src/cli/oauth-login.ts` constructs `createOAuthClient(...)` without passing endpoint overrides from the CLI environment. `packages/poe-oauth/src/oauth-client.ts` consequently defaults `tokenEndpoint` to `https://api.poe.com/token`, even though `src/cli/environment.ts` resolves `POE_BASE_URL` for Poe requests and commands such as `usage balance` use that resolved environment value.

## Suspected Area

The CLI OAuth login wiring should derive the token exchange route from the active Poe base URL configuration rather than relying on the OAuth client's default Poe API endpoint.
