---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:610-628 collectSkillsOption filters empty entries and resolveSkillOptions returns undefined, so --skills \"\" is dropped; --skill \"\" keeps the empty ref via collectOption and hits the malformed branch at packages/agent-skill-config/src/bridge-active-skills.ts:132"
comment: "Good catch and the sharpest empty-flag comparison in the audit: --skill \"\" is rejected as malformed while --skills \"\" succeeds silently, so two flags for the same concept disagree about the same input within one command. That internal contradiction is stronger evidence than any single-flag filing. Consolidate with ux-skills-flag-without-value-is-noop-or-unclear.md and route to the empty-flag rule; the --skill behavior is the correct one to propagate."
---

# UX: --skills "" is silently ignored (spawn succeeds)

## Summary

spawn with --skills "" succeeds without warning — empty skills flag ignored unlike --skill "" which fails malformed.

## Evidence

```bash
$ poe-code spawn … --skills ""
✓ agent: …  # success
$ poe-code spawn … --skill ""
■  Malformed skill references
```

## Why it matters

Inconsistent empty skill flag handling between --skill and --skills.

## Suggested direction

Reject empty --skills when flag present; align with --skill validation.

## Severity

Medium

## Area

Spawn / skills
