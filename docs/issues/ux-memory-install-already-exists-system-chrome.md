---
severity: medium
impact: usability
comment: "Duplicate of ux-memory-install-no-force-already-exists.md; consolidate. Both are instances of the installer-idempotency umbrella (ux-experiment-install-already-exists-vs-pipeline-skip.md): 'already exists' should be idempotent success or offer --force, never a system error. Its framing is the clearer of the two and matches the rule in ux-config-init-already-exists-good.md."
---

# UX: memory install "Skill already exists" uses system-error chrome

## Summary

memory install when skill exists fails with Skill already exists: path and See logs, without --force guidance or design-system-only user error.

## Evidence

```bash
$ poe-code memory install --agent claude-code --skill-only --global
■  Error: Skill already exists: ~/.claude/skills/poe-code-memory/SKILL.md
●  See logs …
```

## Why it matters

Idempotent install should say already installed or offer --force; not look like a crash.

## Suggested direction

ValidationError: already installed; use --force to overwrite; skip errors.log.

## Severity

Medium

## Area

Memory / install
