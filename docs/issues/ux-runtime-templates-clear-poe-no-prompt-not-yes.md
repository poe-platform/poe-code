---
severity: high
impact: usability
comment: "Instance of the POE_NO_PROMPT-versus---yes family; retire into ux-non-tty-prompt-wrong-guidance.md. Its evidence is valuable for the sibling issue and should be carried: --yes works and clears 21 entries, which both proves the flag exists and quantifies what an unguarded clear destroys."
reproduced: y
recommendation: no-fix
evidence: "packages/toolcraft-design/src/prompts/interactive/core.ts:133 non-TTY error names only POE_NO_PROMPT=1; src/cli/commands/runtime/templates/clear.ts:47 skips confirm when flags.assumeYes, so --yes works but is unmentioned"
---

# UX: runtime templates clear non-TTY demands POE_NO_PROMPT not --yes first

## Summary

runtime templates clear without --yes: Interactive prompt requires TTY. Set POE_NO_PROMPT=1 — --yes works when passed but message omits --yes (same class as configure).

## Evidence

clear without --yes → POE_NO_PROMPT; clear --yes → Cleared 21 entries.

## Why it matters

Reconfirm --yes over POE_NO_PROMPT messaging.

## Suggested direction

Message: pass --yes or run in TTY.

## Severity

**High**

## Area

Runtime / non-TTY
