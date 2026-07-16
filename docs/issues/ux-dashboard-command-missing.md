---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- dashboard prints 'Unknown command: dashboard'; maestro tui registered at src/cli/program.ts:637-639; maestro absent from root --help output"
comment: "One of two filings of the same gap (with ux-dashboard-ui-tui-missing.md); consolidate. Correctly diagnosed as discoverability rather than a missing feature: maestro tui exists, so nothing needs building - the surface is simply unreachable from where users look. An alias plus root-help exposure closes it. Depends on the root-help fix (ux-root-help-hides-skill-memory-runtime-eval-and-more.md), which is where maestro tui is hidden in the first place."
---

# UX: dashboard command missing

## Summary

dashboard / dashboard --help → Unknown command. No TUI dashboard entry despite maestro tui existing.

## Evidence

Unknown command: dashboard

## Why it matters

Users looking for dashboard find nothing; maestro tui is hidden too from root help.

## Suggested direction

Either add dashboard alias to maestro tui or document maestro tui on root help.

## Severity

Low–Medium

## Area

Help
