# Login reconfiguration failure leaves mixed deployed credentials

## Summary

When `login --api-key` updates already configured Poe-backed services and a later isolated write fails, the command exits with an error after earlier configurations have already adopted the new key. A single login attempt can leave global and isolated agent configurations using different credentials.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, stubbed Poe validation responses, and a write-protected isolated OpenCode auth directory

## Reproduction

From the repository root, configure two Poe-backed services with an old key, then block the isolated OpenCode auth update before rotating the key through legacy `login`:

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
run configure codex --provider poe --api-key old-poe-secret \
  --model old-codex --reasoning-effort high
run configure opencode --provider poe --api-key old-poe-secret --model old-open
chmod 444 "$probe/home/.poe-code/opencode/.local/share/opencode/auth.json"
chmod 555 "$probe/home/.poe-code/opencode/.local/share/opencode"
run login --api-key new-poe-secret > "$probe/login.out" 2>&1 || true
cat "$probe/login.out"
cat "$probe/home/.codex/config.toml"
cat "$probe/home/.poe-code/codex/config.toml"
cat "$probe/home/.local/share/opencode/auth.json"
cat "$probe/home/.poe-code/opencode/.local/share/opencode/auth.json"
chmod 755 "$probe/home/.poe-code/opencode/.local/share/opencode"
chmod 644 "$probe/home/.poe-code/opencode/.local/share/opencode/auth.json"
```

## Observed Behavior

- `login --api-key new-poe-secret` fails with `EACCES` while attempting to update isolated OpenCode auth JSON.
- Both global and isolated Codex config files already contain `experimental_bearer_token = "new-poe-secret"`.
- Global OpenCode auth JSON already contains `"key": "new-poe-secret"`.
- Isolated OpenCode auth JSON remains on `"key": "old-poe-secret"` because that is the write that fails.
- Codex is additionally reset to the default `gpt-5.5` model and blank reasoning effort before the overall login operation fails, consistent with the separately reported login reconfiguration reset defect.

## Expected Behavior

A login-driven credential rotation across configured services must be atomic: if any reconfiguration cannot complete, no deployed configuration should switch keys, or all earlier mutations and stored-key changes must be rolled back.

## Impact

- Different launch paths for configured services can authenticate with different Poe credentials after a failed login attempt.
- A revoked old key can remain active in isolated tool state while other files use the replacement key.
- Automation receives a failed login result but cannot assume that credential rotation was not partly deployed.

## Supporting Evidence

In `src/cli/commands/login.ts`, `executeLogin(...)` persists the Poe provider key before calling `reconfigureServices(...)`. That function iterates configured Poe-backed services and writes each global configuration before required isolated configuration, with no staging or rollback if a later write throws. This permits partial credential rotation both across services and within one service's global/isolated state.

## Suspected Area

Legacy login reconfiguration needs transaction semantics spanning stored Poe credentials and every configured service's global and isolated files.
