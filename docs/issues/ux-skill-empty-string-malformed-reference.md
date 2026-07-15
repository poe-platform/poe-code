---
severity: low-medium
impact: usability
comment: "Fair and honest: the empty value is correctly rejected, so this is presentation only - the error lists the offending reference as a bare dash, which reads as a rendering artefact rather than 'you passed an empty string'. Its fix is right and belongs with the empty-flag family: validate the empty string at the flag before it reaches the bridge, and the awkward rendering disappears with it."
---

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
