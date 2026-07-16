---
severity: low
impact: none
comment: "Positive pattern, no action. Its Name/Status/Source table with a 'default built-in' source column is a good model for inventory commands that lack provenance - relevant to ux-provider-list-agents-column-incomplete.md and the braintrust status filings, where users cannot tell where a value came from. Cite as precedent."
reproduced: n
recommendation: no-fix
evidence: "packages/github-workflows/src/commands.ts:508-511 defines Name/Status/Source columns; `npm run dev -- gh variables` prints response_style/verify_before_responding as default built-in"
---

# UX: gh variables list is clear (positive)

## Summary

gh variables shows Name/Status/Source table for shared prompt variables — clear inventory.

## Evidence

variables → response_style, verify_before_responding, … default built-in.

## Why it matters

Positive variables inventory.

## Suggested direction

Keep.

## Severity

Low

## Area

GitHub workflows / positive pattern
