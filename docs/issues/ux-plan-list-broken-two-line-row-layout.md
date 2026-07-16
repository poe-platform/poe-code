---
severity: medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "npm run dev -- plan list renders exactly one line per entry, columns Kind/Type/Name/Detail/Updated with in-cell ellipsis; toolcraft-design table.js renderTerminalRow truncates each cell via truncateToWidth (no wrapping in table variant); src/cli/commands/plan.ts:399-403 orders Updated last, contradicting the doc's Kind/Updated header sample"
comment: "Careful and well evidenced: each entry spans two visual rows with the Updated date detached from its content row, so long Kind values wrap and read as status indicators rather than types. It looks like a rendering bug rather than a layout choice, which is the strongest argument here. Related to ux-tables-ignore-terminal-width.md, which may be the underlying cause - check that first."
---

# UX: plan list table uses broken two-line-per-row layout

## Summary

`poe-code plan list` renders a table where each plan entry occupies two visual rows — the Kind value appears on the first row and the Updated date on the second, with no clear visual separator between entries. The result is a dense, hard-to-scan table.

## Evidence

```
| Kind      | Updated    | Type  | Name                     | Detail                  |
| plan      |            | Plan  | trace-browser-html-open.md | Trace browser HTML open |
|           | 2026-07-08 |       |                          |                         |
| plan      |            | Plan  | 32-agent-goal.md         | Agent goal — ...        |
| with …    | 2026-07-08 |       |                          |                         |
```

Kind values that are long wrap to a second sub-row ("plan with ...", "plan del") making them look like status/action indicators rather than types. The Updated date appears on a separate sub-row below the Kind, detached from the content row.

## Why it matters

Users cannot quickly scan the table to find a specific plan. The two-line rows look like artifacts of a rendering bug, not intentional design. Long Kind values get truncated with ellipsis in misleading positions.

## Suggested direction

Merge Kind and Updated into a single row each; if the Kind string is long, truncate it with `...` in-cell rather than wrapping to a sub-row. Consider removing the Kind/Updated split and using a single "Updated" column with the date.

## Severity

Medium

## Area

Plan / list / table layout / visual
