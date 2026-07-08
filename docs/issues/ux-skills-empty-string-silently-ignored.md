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
