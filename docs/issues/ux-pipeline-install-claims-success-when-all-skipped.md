---
severity: medium
impact: usability
comment: "Real and cleanly evidenced: both steps skip as already-existing and the command still reports 'Installed Pipeline skill', so the success line contradicts the two lines above it. Same overclaiming as ux-install-always-success-reconfirmed.md, and the fix is the rule from ux-config-init-already-exists-good.md - already-exists is idempotent success, so say 'already installed (nothing to do)' rather than claiming an install. Part of the installer-consistency umbrella."
---

# UX: pipeline install claims Installed when all steps skipped

## Summary

pipeline install when steps.yaml and skill already exist: Skip both; then Installed Pipeline skill… success — overclaims success when nothing changed.

## Evidence

```bash
$ poe-code pipeline install --agent claude --local --yes
●  Skip: .poe-code/pipeline/steps.yaml (already exists)
●  Skip: .claude/skills/… (already exists)
◆  Installed Pipeline skill …
```

## Why it matters

Success glyph on no-op confuses idempotent re-runs.

## Suggested direction

Already installed (nothing to do); or list skips without Installed.

## Severity

Medium

## Area

Pipeline / install
