---
severity: low-medium
impact: discoverability
comment: "The most careful of the three --feature semantics filings and it supplies the evidence the contradictory pair lacks: --tools with --feature web_search returns models with both columns checked, so filters AND. That supports ux-models-double-feature-flag-uses-last-or-and.md over ux-models-feature-flag-not-repeatable.md. Keep as the documentation ask (state AND explicitly) and use its evidence to settle the repeatability question."
---

# UX: Combining --tools with --feature semantics undocumented

## Summary

--tools is documented as shorthand for --feature tools, but combining --tools with --feature web_search returns models with both tools and web_search (AND). Help does not state multi-feature AND semantics.

## Evidence

models --tools --feature web_search --provider anthropic returns models with both columns checked.
Help: --tools Shorthand for --feature tools — does not explain stacking.

## Why it matters

Users may expect OR or override; silent AND is surprising.

## Suggested direction

Document filter combination as AND; allow repeated --feature.

## Severity

Low–Medium

## Area

Models
