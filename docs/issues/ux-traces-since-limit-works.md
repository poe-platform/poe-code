---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect: --since/--limit wired in src/cli/commands/traces.ts:84-125 and applied in packages/agent-traces/src/collect.ts:97,129"
comment: "Third filing of the traces filter-composition positive; retire into ux-traces-since-and-source-limit-work.md. Coverage only."
---

# UX: traces --since 1h --limit 3 works (positive)

## Summary

traces --since 1h --limit 3 returns 3 recent traces with sources — filters work.

## Evidence

3 rows from codex/poe-code/claude.

## Why it matters

Positive filter composition.

## Suggested direction

Keep.

## Severity

Low

## Area

Traces / positive pattern
