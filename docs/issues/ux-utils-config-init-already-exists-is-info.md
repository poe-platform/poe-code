---
severity: low
impact: none
comment: "Keep as the canonical already-exists positive and cite it widely: it is the reference the installer-idempotency cluster needs, where the same condition produces a hard error (experiment), a system error with a debug tease (superintendent, memory, skill) or a false success (pipeline). Its own suggestion says it: mirror this for skill and memory installs. One small file settling a five-command inconsistency."
---

# UX: utils config init already exists is calm info (positive)

## Summary

config init when project config exists prints Project config already exists at path without error exit drama — good idempotent messaging.

## Evidence

```bash
$ poe-code utils config init
●  Project config already exists at …/.poe-code/config.json
```

## Why it matters

Positive pattern for exists cases (contrast experiment install hard error).

## Suggested direction

Mirror for skill/memory installs.

## Severity

Low

## Area

Utils / positive pattern
