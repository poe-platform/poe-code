# Logout and auth status ignore Poe environment credential

## Summary

When `POE_API_KEY` is present without a stored credential file, top-level `logout` reports `Already logged out.` and `auth status` reports `Not logged in`, while `provider list` reports Poe as `[logged in]` and `auth whoami` authenticates successfully from the same environment credential.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, `POE_API_KEY` set only in the command environment, and a stubbed Poe auth response

## Reproduction

From the repository root, invoke status and logout commands in a disposable home with only `POE_API_KEY` supplied:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(
  JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
  { status: 200, headers: { 'content-type': 'application/json' } }
);
EOF
run_env() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" POE_API_KEY=environment-poe-secret \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run_env provider list
run_env logout
run_env provider list
run_env auth status
run_env auth whoami
find "$probe/home" -type f -print | sort || true
```

## Observed Behavior

- With no credential file on disk, `provider list` reports Poe as `[logged in]` because `POE_API_KEY` is set.
- Top-level `logout` prints `Already logged out.` and exits successfully.
- A subsequent `provider list` still reports Poe as `[logged in]`, while `auth status` reports `Not logged in` in the same environment.
- `auth whoami` successfully resolves the environment credential and returns the authenticated identity, contradicting `auth status` on the same active session.

## Expected Behavior

Authentication status and logout messaging must consistently account for an active `POE_API_KEY` environment credential. If logout cannot remove that credential, it should state that Poe remains authenticated until the variable is unset.

## Impact

- Users receive contradictory login status from commands in the same shell environment.
- A logout attempt can appear complete while Poe-authenticated commands remain enabled by an exported secret.
- Incident response and CI cleanup workflows can fail to identify active environment-based authentication.

## Supporting Evidence

In `packages/providers/src/registry.ts`, provider login status returns true when the configured provider environment variable is present. In `src/cli/commands/logout.ts`, top-level logout reads/deletes only the Poe secret store and treats an empty store as already logged out. In `src/cli/commands/auth.ts`, `auth status` reads only the stored API key, whereas `auth whoami` calls `resolveAuthCredential(...)`, which explicitly prefers `POE_API_KEY`.

## Suspected Area

Top-level Poe auth status and logout need to surface environment-backed authentication consistently with the provider registry and avoid declaring logout completion when an active environment key remains.
