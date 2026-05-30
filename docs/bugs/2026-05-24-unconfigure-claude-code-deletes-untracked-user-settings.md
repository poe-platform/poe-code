---
name: "Unconfigure Claude Code deletes untracked user settings"
---

# Unconfigure Claude Code deletes untracked user settings

## Summary

Running `unconfigure claude-code` removes user-created Claude Code API key, endpoint, and model settings even when Claude Code was never configured or tracked by Poe Code.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a manually seeded Claude Code settings file only

## Reproduction

From the repository root, create an independent Claude Code configuration and run Poe Code unconfigure without any prior configure action:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.claude" "$probe/project"
cat > "$probe/home/.claude/settings.json" <<'EOF'
{
  "env": {
    "ANTHROPIC_API_KEY": "user-own-key",
    "ANTHROPIC_BASE_URL": "https://user.example.test",
    "USER_SETTING": "keep"
  },
  "model": "user-model",
  "theme": "keep"
}
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes unconfigure claude-code
)
cat "$probe/home/.claude/settings.json"
find "$probe/home/.poe-code" -type f -print 2>/dev/null || true
```

## Observed Behavior

- No Poe Code metadata exists; `~/.claude/settings.json` is manually seeded only.
- `unconfigure claude-code` reports `Removed Claude Code configuration.`.
- It deletes `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and `model` from the user-created file, while preserving unrelated `USER_SETTING` and `theme` fields.

## Expected Behavior

Unconfigure must remove only Claude Code values installed and tracked by Poe Code. It must not remove independently managed authentication, endpoint, or model settings solely because they match fields Poe Code also uses.

## Impact

- Users can lose manually configured Claude Code credentials and preferences without ever having used Poe Code configuration for that tool.
- A cleanup command destructively targets compatible user-owned state without proving ownership.
- Restoring the user's authentication and model configuration requires manual recovery.

## Supporting Evidence

In `src/cli/commands/unconfigure.ts`, the Claude Code unconfigure manifest runs without requiring configured-service metadata. In `src/providers/claude-code.ts`, its manifest prunes common Claude settings keys (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and `model`) regardless of their provenance.

## Suspected Area

Claude Code unconfigure must require tracked ownership or restore/preserve user-managed values not authored by Poe Code.
