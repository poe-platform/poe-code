---
name: "Unconfigure Codex deletes untracked user provider config"
---

# Unconfigure Codex deletes untracked user provider config

## Summary

Running `unconfigure codex` removes the active user-created Codex provider/model configuration even when Codex was never configured or tracked by Poe Code, regardless of the provider id.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a manually seeded Codex TOML file only

## Reproduction

From the repository root, seed independent Codex configuration using an arbitrary provider id, then run unconfigure:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.codex" "$probe/project"
cat > "$probe/home/.codex/config.toml" <<'EOF'
model_provider = "my_gateway"
model = "user-codex"
model_reasoning_effort = "high"
user_setting = "keep"

[model_providers.my_gateway]
name = "my_gateway"
base_url = "https://user.example.test/v1"
experimental_bearer_token = "user-own-secret"
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes unconfigure codex
)
cat "$probe/home/.codex/config.toml"
find "$probe/home/.poe-code" -type f -print 2>/dev/null || true
```

## Observed Behavior

- No Poe Code configured-service metadata exists; the Codex TOML file is manually seeded only.
- `unconfigure codex` reports `Removed Codex configuration.`.
- It deletes top-level `model_provider`, `model`, and `model_reasoning_effort`, plus the entire user-created `[model_providers.my_gateway]` table containing its endpoint and bearer token; only unrelated `user_setting` remains.

## Expected Behavior

Unconfigure must remove only Codex provider/model state installed and tracked by Poe Code. It must not delete an independent active user provider configuration when no ownership metadata exists.

## Impact

- Users can lose independently maintained Codex model routing and authentication credentials by running Poe Code cleanup.
- Any active provider selection is treated as removable managed state without metadata or confirmation.
- The cleanup command destroys a complete working provider selection and secret-bearing provider table.

## Supporting Evidence

In `src/cli/commands/unconfigure.ts`, unconfigure invokes the service manifest even when no tracked configuration exists. In `src/providers/codex.ts`, `stripCodexConfiguration(...)` derives and removes whichever provider id is found in the document when no tracked provider context is supplied, so any active user provider can be treated as removable managed state.

## Suspected Area

Codex unconfigure must require tracked provider ownership or a Poe Code-specific marker before deleting provider tables and selected model state.
