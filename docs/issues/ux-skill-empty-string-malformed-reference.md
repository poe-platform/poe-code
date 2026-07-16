---
severity: low-medium
impact: usability
comment: "Fair and honest: the empty value is correctly rejected, so this is presentation only - the error lists the offending reference as a bare dash, which reads as a rendering artefact rather than 'you passed an empty string'. Its fix is right and belongs with the empty-flag family: validate the empty string at the flag before it reaches the bridge, and the awkward rendering disappears with it."
reproduced: y
recommendation: fix
evidence: "packages/agent-skill-config/src/resolve-skill-reference.ts:80-84 returns {kind: malformed, ref: ''} for an empty ref; packages/agent-skill-config/src/bridge-active-skills.ts:133-134 renders it as `- ${failure.ref}`, i.e. a bare dash; test resolve-skill-reference.test.ts:221 asserts '' is malformed."
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
