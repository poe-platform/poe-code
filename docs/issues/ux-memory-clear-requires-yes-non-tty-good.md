---
severity: low
impact: none
comment: "Small positive with outsized value: it is the live evidence refuting ux-memory-clear-no-yes-no-dry-run.md and ux-memory-clear-no-confirmation.md, which claim memory clear is ungated. Keep it and link it from those files as the correction. The guard is exactly the pattern ux-auth-logout-no-confirmation-removes-all-agents.md asks for - so memory clear is the in-product precedent for gating logout rather than another instance of the same failure."
---

# UX: memory clear non-TTY requires --yes (positive)

## Summary

memory clear without --yes: memory clear requires --yes when running without an interactive TTY — clear destructive guard (help still omits --yes).

## Evidence

```bash
$ poe-code memory clear
■  memory clear requires --yes when running without an interactive TTY.
```

## Why it matters

Positive non-TTY destructive guard; document --yes on help.

## Suggested direction

Add --yes to memory clear help; keep requirement.

## Severity

Low

## Area

Memory / positive pattern
