---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/config.ts:126 logs info 'Project config already exists at ...' then returns; no error exit. Positive note, no defect to reproduce."
comment: "Positive pattern, no code change; duplicate of ux-utils-config-init-already-exists-is-info.md - consolidate the pair. The reusable rule worth keeping: 'already exists' is idempotent success, not an error. That rule is directly relevant to ux-experiment-install-force-still-skill-already-exists.md, where the same phrase wrongly blocks a legitimate --force."
---

# UX: utils config init already exists is clear (positive)

## Summary

utils config init: Project config already exists at path — clear idempotent message.

## Evidence

Project config already exists at …/.poe-code/config.json

## Why it matters

Positive init idempotence.

## Suggested direction

Keep.

## Severity

Low

## Area

Utils / positive pattern
