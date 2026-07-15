---
severity: high
impact: usability
comment: "Valid and cheap: --yes works, yet the error names only POE_NO_PROMPT=1, so the flag users already know from other commands goes unmentioned and they are pushed toward an obscure env var. Same message-vs-reality gap as ux-test-nontty-demands-poe-no-prompt-not-yes.md and ux-runtime-init-non-tty-poe-no-prompt.md; one shared non-TTY message should name --yes first and mention the env var only as the CI alternative."
---

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
