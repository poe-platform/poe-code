---
severity: medium
impact: usability
comment: "Two issues bundled: the success-glyph-on-failure half duplicates ux-failure-shown-as-success-markers.md, but the multi-plan half is distinct and worth keeping - when plan 1 of 2 fails, nothing states that plan 2 was skipped, so users cannot tell whether the run was partial or complete. That silence is the real gap; --continue-on-error is a reasonable follow-on but the summary is the minimum."
---

# UX: gaslight --plans fails plan 1/2 with success markers and no remaining-plan summary

## Summary

Multi-plan gaslight fails first plan with ✓ agent API error and message plan 1/2 … failed without summarizing that plan 2 was skipped.

## Evidence

```bash
$ poe-code gaslight --plans a.md b.md --yes --mode read
✓ agent: API Error…
■  Error: Gaslight plan 1/2 (a.md) round 1 failed…
```

## Why it matters

Multi-plan users need clear skip/continue policy and no success markers on failure.

## Suggested direction

Fix markers; print skipped remaining plans; optional --continue-on-error.

## Severity

Medium

## Area

Gaslight
