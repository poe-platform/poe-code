---
name: "Unconfigure Codex does not restore overwritten user selection"
---

# Unconfigure Codex does not restore overwritten user selection

## Summary

Configuring Codex replaces an existing user-selected `model_provider`, `model`, and reasoning selection, and a later `unconfigure codex` removes Poe Code state without restoring the original active selection.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, seed existing Codex selection/provider configuration, configure through Poe Code, and unconfigure it:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.codex" "$probe/project"
cat > "$probe/home/.codex/config.toml" <<'EOF'
model_provider = "user_provider"
model = "user-model"
model_reasoning_effort = "low"
user_setting = "keep"

[model_providers.user_provider]
name = "user_provider"
base_url = "https://user.example.test"
EOF
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run configure codex --provider cloudflare --api-key cleanup-codex \
  --base-url https://gateway.example.test --model cleanup-codex --reasoning-effort high
cat "$probe/home/.codex/config.toml"
run unconfigure codex
cat "$probe/home/.codex/config.toml"
```

## Observed Behavior

- Configuration changes the active Codex selection from `user_provider` / `user-model` / `low` to Cloudflare / `cleanup-codex` / `high`, while preserving the user's provider definition table and unrelated setting.
- Unconfigure removes Cloudflare provider/profile configuration and preserves `model_providers.user_provider` plus `user_setting`.
- Unconfigure does not restore top-level `model_provider = "user_provider"`, `model = "user-model"`, or `model_reasoning_effort = "low"`, leaving the original provider definition no longer selected.

## Expected Behavior

If Poe Code replaces an existing Codex active model/provider selection, unconfigure must restore that original selection or avoid changing user-owned defaults irreversibly.

## Impact

- Users lose their prior active Codex provider/model/reasoning selection after trying and removing Poe Code setup.
- Retained provider definitions are left inactive, requiring manual reconstruction of the prior selected configuration.
- Top-level logout inherits this destructive unconfigure behavior.

## Supporting Evidence

In `src/providers/codex.ts`, configure writes top-level model/provider/reasoning values and a managed provider/profile. `stripCodexConfiguration(...)` removes active top-level values whenever they reference the managed provider, but it does not persist or restore top-level selections that existed before configuration.

## Suspected Area

Codex configuration needs backup/restore semantics for overwritten active selection fields, or a non-destructive profile-based activation model that can revert to prior user state.
