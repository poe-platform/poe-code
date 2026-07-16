---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- dashboard|ui|tui each print 'Unknown command'; only maestro tui registered at src/cli/program.ts:638; no top-level registration in src/cli/program.ts:868-959"
comment: "Duplicate of ux-dashboard-command-missing.md; keep one. Its added value is breadth - dashboard, ui and tui are all rejected - which argues the fix should cover the obvious synonyms rather than a single exact word. The npm run dev half belongs to the identity cluster."
---

# UX: dashboard/ui/tui commands missing (product surface gap)

## Summary

dashboard, ui, tui are Unknown command with npm run dev help — no interactive dashboard entrypoint in CLI.

## Evidence

```bash
$ poe-code dashboard
■  Unknown command: dashboard
```

## Why it matters

Users looking for interactive UI find nothing; maestro tui exists under maestro only.

## Suggested direction

Document maestro tui / plan TUI; or add dashboard alias; fix binary name in errors.

## Severity

Low–Medium

## Area

Help / discoverability
