---
severity: high
impact: usability
comment: "Fourth 'refuse to replace' filing; retire into ux-hooks-auto-strategy-still-refuses-user-settings.md. It is the fairest of the group in conceding the refusal is good safety and the recovery is the weak part, and it names the two missing pieces precisely: no --force and no pointer to auto. Keep that framing - while noting auto does not work either, which is why the auto file is canonical."
---

# UX: hooks-strategy symlink refuses user-authored settings without recovery path

## Summary

spawn with --hooks-from claude-code --hooks-strategy symlink fails Refuse to replace user-authored hook file at .claude/settings.json — good safety, weak recovery (no --force, no suggest auto strategy).

## Evidence

```bash
$ poe-code spawn … --hooks-from claude-code --hooks-strategy symlink
■  Error: Refuse to replace user-authored hook file at …/.claude/settings.json
●  See logs …
```

## Why it matters

Users stuck; help advertises symlink as valid choice.

## Suggested direction

Suggest --hooks-strategy auto; document when symlink is safe; drop See logs.

## Severity

**High**

## Area

Hooks / spawn
