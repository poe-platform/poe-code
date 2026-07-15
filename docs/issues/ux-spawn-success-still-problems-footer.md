---
severity: low-medium
impact: polish
comment: "Instance of ux-problems-footer-on-every-success.md; retire into it. Its multi-agent evidence (pi, claude, goose all ending the same way) usefully confirms the footer is unconditional in finalize rather than per-command, which is what makes the fix a single change."
---

# UX: Successful spawn still ends with Problems? footer

## Summary

Even successful spawn pi/claude/goose runs end with Problems? GitHub issues link, training users to ignore it and cluttering success.

## Evidence

Successful spawn ends with Problems? https://github.com/…/issues

## Why it matters

Reaffirms Problems-footer-on-success issue with live multi-agent evidence.

## Suggested direction

Only show Problems footer on failure or first-run.

## Severity

Low–Medium

## Area

Design system
