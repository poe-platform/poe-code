# UX: --skill "" fails as Malformed skill reference with empty dash

## Summary

spawn --skill "" fails Malformed skill references: - (empty) Expected syntax name or agentId/name — empty skill flag rejected (good) but display is awkward with bare dash.

## Evidence

```bash
$ poe-code spawn … --skill ""
■  Failed to bridge… Malformed skill references:
│  -
│  Expected syntax: "<name>" or "<agentId>/<name>".
```

## Why it matters

Empty skill should say Skill reference must not be empty.

## Suggested direction

ValidationError for empty string before bridge.

## Severity

Low–Medium

## Area

Spawn / skills
