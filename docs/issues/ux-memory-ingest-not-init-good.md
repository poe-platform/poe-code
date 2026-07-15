---
severity: low
impact: none
comment: "Positive pattern worth citing: 'Memory is not initialized. Run \"poe-code memory init\" in this project.' names the state, the fix and the scope in one line - the recovery shape the braintrust and configure filings ask for (ux-braintrust-status-disabled-no-next-step.md). Consistent across the memory group; use as the reference example."
---

# UX: memory ingest without init points to memory init (positive)

## Summary

Memory is not initialized. Run poe-code memory init — clear recovery.

## Evidence

```bash
$ poe-code memory ingest /tmp/no.txt --yes
■  Memory is not initialized. Run "poe-code memory init" in this project.
```

## Why it matters

Positive not-initialized pattern across memory commands.

## Suggested direction

Keep.

## Severity

Low

## Area

Memory / positive pattern
