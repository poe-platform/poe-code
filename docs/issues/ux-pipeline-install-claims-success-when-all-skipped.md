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
