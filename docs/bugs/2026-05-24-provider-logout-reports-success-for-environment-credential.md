# Provider logout reports success for environment credential

## Summary

Running `provider logout cloudflare` while Cloudflare authentication is supplied through `CF_AIG_TOKEN` prints a successful logout message even though the provider remains reported as logged in immediately afterward.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and `CF_AIG_TOKEN` set only in the command environment

## Reproduction

From the repository root, run provider status and provider logout with an environment-only Cloudflare credential:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
run_env() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" CF_AIG_TOKEN=environment-secret \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
printf '%s\n' '=== status before provider logout ==='
run_env provider list
printf '%s\n' '=== provider logout output ==='
run_env provider logout cloudflare
printf '%s\n' '=== status after provider logout ==='
run_env provider list
find "$probe/home" -type f -print | sort || true
```

## Observed Behavior

- Before logout, `provider list` reports Cloudflare as `[logged in]` solely because `CF_AIG_TOKEN` is present; the disposable home has no stored credential file.
- `provider logout cloudflare` prints `Logged out from cloudflare.`.
- With the same environment still present, `provider list` immediately continues reporting Cloudflare as `[logged in]`.

## Expected Behavior

When provider authentication is sourced from an environment variable that cannot be removed by the CLI, `provider logout` must not report an effective logout; it should state that the provider remains authenticated until the environment credential is unset.

## Impact

- Users can believe an active provider credential was disabled while all subsequent commands remain authenticated through the environment.
- CI and shell-session incident response may fail to neutralize a leaked or unintended credential.
- Status output immediately contradicts the success message emitted by the logout command.

## Supporting Evidence

In `packages/providers/src/registry.ts`, `isLoggedIn(id)` returns `true` whenever the provider auth environment variable is non-empty before consulting its secret store. The same registry's `logout(id)` only deletes the secret store. In `src/cli/commands/provider.ts`, `executeProviderLogout(...)` unconditionally reports `Logged out from ${id}.` after that store deletion without checking environment-backed authentication.

## Suspected Area

Provider logout must detect environment-sourced credentials and render an accurate non-logout warning or require the user to unset the corresponding environment variable.
