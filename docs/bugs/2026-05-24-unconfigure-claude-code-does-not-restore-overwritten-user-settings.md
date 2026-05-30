---
name: "Unconfigure Claude Code does not restore overwritten user settings"
---

# Unconfigure Claude Code does not restore overwritten user settings

## Summary

Configuring Claude Code overwrites existing user `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and `model` values, and a later `unconfigure claude-code` deletes those settings rather than restoring the original user values.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, seed an existing Claude Code settings file, configure Claude Code through Poe Code, and then unconfigure it:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.claude" "$probe/project"
cat > "$probe/home/.claude/settings.json" <<'EOF'
{
  "env": {
    "ANTHROPIC_API_KEY": "user-original-key",
    "ANTHROPIC_BASE_URL": "https://user-original.example.test",
    "USER_SETTING": "keep"
  },
  "model": "user-original-model",
  "theme": "keep"
}
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
run configure claude-code --provider anthropic --api-key cleanup-claude --model cleanup-claude
cat "$probe/home/.claude/settings.json"
run unconfigure claude-code
cat "$probe/home/.claude/settings.json"
```

## Observed Behavior

- Configuration changes the user values to `"ANTHROPIC_API_KEY": "cleanup-claude"`, `"ANTHROPIC_BASE_URL": "https://api.anthropic.com"`, and `"model": "cleanup-claude"`, while preserving unrelated settings.
- Unconfigure preserves unrelated `USER_SETTING` and `theme` values.
- Unconfigure deletes the modified API key, base URL, and model settings entirely instead of restoring `user-original-key`, `https://user-original.example.test`, and `user-original-model`.

## Expected Behavior

If Poe Code overwrites existing Claude Code authentication or model settings, unconfigure must restore the original values or avoid destructive replacement of user-owned configuration.

## Impact

- Users lose their pre-existing Claude Code authentication endpoint and model preferences after trying and removing Poe Code configuration.
- Credential/base URL restoration requires manual recovery of values that were present before configuration.
- Top-level logout inherits the same destructive cleanup behavior because it invokes service unconfigure.

## Supporting Evidence

In `src/providers/claude-code.ts`, configure first prunes managed auth fields and then merges provider environment/base URL plus model into `~/.claude/settings.json`. Its unconfigure manifest prunes API-key/header/base-URL and model keys, but does not record or restore values that existed before configuration.

## Suspected Area

Claude Code configuration needs backup/restore semantics for overwritten user fields, or it must avoid modifying existing user-managed authentication and model settings irreversibly.
