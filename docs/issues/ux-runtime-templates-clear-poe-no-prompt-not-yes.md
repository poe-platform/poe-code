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
