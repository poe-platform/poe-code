# UX: --hooks-strategy auto still refuses user-authored settings

## Summary

--hooks-from claude-code --hooks-strategy auto fails same Refuse to replace user-authored hook file — auto does not fall back to a non-destructive path.

## Evidence

```bash
$ poe-code spawn … --hooks-from claude-code --hooks-strategy auto
■  Error: Refuse to replace user-authored hook file at …/.claude/settings.json
```

## Why it matters

auto strategy name implies it would choose a working path.

## Suggested direction

auto should merge or skip with warning, not hard-fail like symlink.

## Severity

**High**

## Area

Hooks / spawn
