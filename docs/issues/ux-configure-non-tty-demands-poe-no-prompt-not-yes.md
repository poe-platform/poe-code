# UX: configure without --yes non-TTY demands POE_NO_PROMPT not --yes

## Summary

configure claude without --yes in non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — --yes works for defaults but message does not mention --yes (inconsistent with install/login messaging).

## Evidence

```bash
$ poe-code configure claude
■  Error: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 to accept defaults non-interactively.
```

## Why it matters

Users know --yes from other commands; POE_NO_PROMPT is obscure.

## Suggested direction

Message: pass --yes or run in a TTY; honor --yes everywhere; deprecate POE_NO_PROMPT in user copy.

## Severity

**High**

## Area

Configure / non-TTY
