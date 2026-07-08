# UX: --hooks-scope project still refuses user settings (recovery gap)

## Summary

--hooks-from claude-code --hooks-scope project fails same Refuse to replace user-authored hook file — scope does not avoid the refuse path.

## Evidence

```bash
$ poe-code spawn … --hooks-from claude-code --hooks-scope project
■  Error: Refuse to replace user-authored hook file at …/.claude/settings.json
```

## Why it matters

Scope flag looks like a workaround but fails the same way.

## Suggested direction

Document when refuse happens; offer auto strategy that merges without replace.

## Severity

Medium

## Area

Hooks
