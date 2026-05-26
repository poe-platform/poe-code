# Logout leaves non-Poe provider credentials

## Summary

Running the top-level `logout` command, which is described as removing all configuration and credentials, leaves stored Anthropic and Cloudflare provider credentials intact, leaves Cloudflare provider endpoint configuration intact, and still reports those providers as logged in.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, log in to two non-Poe providers in a disposable home, run global logout, and inspect provider status:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run provider login cloudflare --api-key cloudflare-secret --base-url https://gateway.example.test
run provider login anthropic --api-key anthropic-secret
printf '%s\n' '=== before logout ==='
find "$probe/home/.poe-code" -maxdepth 1 -type f -print | sort
cat "$probe/home/.config/poe-code/services.json"
run logout
printf '%s\n' '=== after logout ==='
find "$probe/home/.poe-code" -maxdepth 1 -type f -print | sort
cat "$probe/home/.config/poe-code/services.json"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" provider list
)
```

## Observed Behavior

- Before logout, the disposable home contains `credentials.anthropic.enc` and `credentials.cloudflare.enc`.
- Global `logout` prints `Already logged out.` even though non-Poe provider credentials exist.
- After logout, both credential files still exist and `provider list` reports Anthropic and Cloudflare as `[logged in]`.
- Cloudflare's `shapeBaseUrls` remain persisted in `~/.config/poe-code/services.json` after a command advertised as removing all configuration.

## Expected Behavior

The top-level `logout` command advertised as `Remove all configuration and credentials.` must remove credentials for every configured/supported provider, or its behavior and wording must be explicitly scoped to Poe-only authentication.

## Impact

- Users can believe they logged out completely while active provider secrets and associated routing configuration remain stored locally.
- Shared-machine cleanup, credential rotation, and security response workflows may leave reusable authentication behind.
- The success message is misleading in the presence of provider-specific authentication stores.

## Supporting Evidence

In `src/cli/commands/logout.ts`, the command description is `Remove all configuration and credentials.`, but `executeLogout(...)` calls only `container.deleteApiKey()`. In `src/cli/container.ts`, `deleteApiKey` is bound specifically to the Poe authentication store, while provider-specific stores are created as `credentials.<providerId>.enc`. The provider registry supports provider-specific logout through `packages/providers/src/registry.ts`, but global logout does not invoke it.

## Suspected Area

Global logout must enumerate authenticated providers and remove each provider credential store plus provider configuration state, or be renamed and documented as Poe-only logout.
