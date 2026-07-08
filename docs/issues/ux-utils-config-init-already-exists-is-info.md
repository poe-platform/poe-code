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
