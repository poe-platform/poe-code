---
name: "Unconfigure OpenCode deletes untracked user provider auth"
---

# Unconfigure OpenCode deletes untracked user provider auth

## Summary

Running `unconfigure opencode` removes user-created Poe provider/auth configuration even when OpenCode was never configured or tracked by Poe Code.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and manually seeded OpenCode files only

## Reproduction

From the repository root, seed OpenCode provider/auth files directly without invoking Poe Code configuration, then run unconfigure:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.config/opencode" "$probe/home/.local/share/opencode" "$probe/project"
cat > "$probe/home/.config/opencode/config.json" <<'EOF'
{"model":"poe/user-managed","enabled_providers":["poe"],"theme":"keep"}
EOF
cat > "$probe/home/.local/share/opencode/auth.json" <<'EOF'
{"poe":{"type":"api","key":"user-own-secret"}}
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes unconfigure opencode
)
cat "$probe/home/.config/opencode/config.json"
cat "$probe/home/.local/share/opencode/auth.json" 2>/dev/null || true
find "$probe/home/.poe-code" -type f -print 2>/dev/null || true
```

## Observed Behavior

- No Poe Code configured-service metadata exists; both OpenCode files are manually seeded user configuration.
- `unconfigure opencode` reports `Removed OpenCode CLI configuration.`.
- It deletes the user-created `enabled_providers: ["poe"]` setting and removes the entire user-created Poe auth object containing `user-own-secret`; only unrelated `theme` and the Poe-prefixed model remain.

## Expected Behavior

Unconfigure must remove only OpenCode provider/auth values established and tracked by Poe Code. It must not delete independently managed Poe-compatible OpenCode credentials based solely on matching provider ids.

## Impact

- Users can lose active OpenCode authentication and provider enablement that Poe Code did not create.
- Cleanup can destructively target manually maintained or third-party-compatible configurations with no ownership proof.
- The remaining model references Poe while its user auth/provider enablement has been removed, potentially breaking the user's setup.

## Supporting Evidence

In `src/cli/commands/unconfigure.ts`, unconfigure manifests execute regardless of tracked configuration metadata. In `src/providers/opencode.ts`, the unconfigure manifest prunes `enabled_providers` and the `poe` auth entry from the discovered OpenCode files without checking whether Poe Code authored those values.

## Suspected Area

OpenCode unconfigure must require ownership metadata or preserve user-created compatible provider/auth entries that were not installed through Poe Code.
