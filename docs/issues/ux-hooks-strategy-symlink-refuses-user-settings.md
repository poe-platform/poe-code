---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "packages/agent-hook-config/src/symlink-hooks.ts:167 throws 'Refuse to replace user-authored hook file' with no --force escape and no hint toward auto; src/cli/commands/spawn.ts:113-117 still advertises symlink as a valid --hooks-strategy choice; no force/hooksForce flag exists in symlink-hooks.ts or bridge-hooks.ts. Duplicate of ux-hooks-auto-strategy-still-refuses-user-settings.md, which is canonical."
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
