---
severity: low
impact: none
comment: "Keep of this positive pair as the reference status card: it names the value, the breakdown, the next grant and a next-step link - the shape ux-memory-status-after-write-is-terse.md and ux-braintrust-status-minimal-disabled.md both lack. Cite as the template for status output across the CLI."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/usage.ts:73 renders Balance with Plan/Add-on breakdown, :84 Next monthly grant, :151 'Need more points?' feedback link - positive note, no defect to reproduce"
---

# UX: usage balance presentation is good (positive)

## Summary

usage balance shows Balance, Plan, Add-on, next grant with design-system framing and helpful next-points link.

## Evidence

```text
◆  Usage balance fetched
●  Balance: $720.11 …
   Plan / Add-on breakdown
●  Next monthly grant: …
Need more points? https://poe.com/api/keys
```

## Why it matters

Positive pattern for status cards.

## Suggested direction

Keep; use for memory status / auth status consistency.

## Severity

Low

## Area

Usage / positive pattern
