# Logout cleanup failure leaves account logged in and services partially removed

## Summary

If `logout` encounters a failure while unconfiguring one tracked service, it aborts before deleting the stored Poe credential while earlier services have already been removed. The command exits with an error but leaves the account authenticated and installed services in a partially removed state.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, stubbed Poe validation responses, and a write-protected isolated OpenCode auth directory

## Reproduction

From the repository root, log in, configure two Poe-backed services, and prevent isolated OpenCode auth cleanup before running top-level logout:

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
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run login --api-key logout-stored-secret
run configure codex --provider poe --model codex-before --reasoning-effort high
run configure opencode --provider poe --model open-before
chmod 444 "$probe/home/.poe-code/opencode/.local/share/opencode/auth.json"
chmod 555 "$probe/home/.poe-code/opencode/.local/share/opencode"
run logout > "$probe/logout.out" 2>&1 || true
cat "$probe/logout.out"
run auth status
find "$probe/home/.poe-code" -type f -print | sort
cat "$probe/home/.poe-code/opencode/.local/share/opencode/auth.json"
cat "$probe/home/.poe-code/config.json"
chmod 755 "$probe/home/.poe-code/opencode/.local/share/opencode"
chmod 644 "$probe/home/.poe-code/opencode/.local/share/opencode/auth.json"
```

## Observed Behavior

- `logout` first prints `Removed Codex configuration.` and then fails with `EACCES` while deleting isolated OpenCode auth state.
- Codex global and isolated configuration have already been deleted, while isolated OpenCode auth JSON remains and contains `"key": "logout-stored-secret"`.
- Both `~/.poe-code/credentials.enc` and `~/.poe-code/credentials.poe.enc` remain after the failed logout.
- Running `auth status` after the failed logout still reports that the user is logged in.
- `~/.poe-code/config.json` retains only the not-fully-cleaned OpenCode entry, exposing a partially removed installation state.

## Expected Behavior

Top-level logout must be atomic across configured-service cleanup and Poe credential removal, or at minimum remove stored credentials before reporting/returning failure so a failed cleanup cannot leave the account authenticated with retained deployed secrets.

## Impact

- A failed logout attempt can leave both the stored account credential and a deployed isolated service credential active.
- Some services are removed while others remain, requiring manual state recovery after a command intended to remove all configuration and credentials.
- Users cannot treat a failed logout as safely logged out or safely unchanged.

## Supporting Evidence

In `src/cli/commands/logout.ts`, `executeLogout(...)` iterates configured services and awaits `executeUnconfigure(...)` for each service before invoking `container.deleteApiKey()` and deleting config. If any service unconfigure throws, the loop aborts before credentials are deleted, after earlier service cleanups may already have committed mutations.

## Suspected Area

Top-level logout needs transactional coordination or failure-safe credential revocation around its sequential service cleanup loop.
