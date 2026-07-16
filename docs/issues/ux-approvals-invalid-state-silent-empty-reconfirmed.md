---
severity: medium
impact: correctness
reproduced: y
recommendation: fix
evidence: "packages/toolcraft/src/human-in-loop/approvals-commands.ts:20 declares state as S.Optional(S.String()) with no enum; backend gh-issues.ts filters by exact task.state equality, so `npm run dev -- approvals list --state bogus` prints 'No approvals found.' with exit 0"
comment: "Keep as canonical of this pair (it has the repro). Valid and worth fixing: an unvalidated --state silently returns 'No approvals found', which is indistinguishable from a genuinely empty queue, so a user can conclude nothing is pending when their filter was simply misspelled. Validate the enum and list valid states. Same silent-empty-filter class as ux-models-search-empty-returns-all.md and ux-usage-list-empty-filter-returns-all.md - fix as a family."
---

# UX: approvals list --state bogus still silent empty (reconfirmed)

## Summary

approvals list --state bogus returns No approvals found without invalid-state error — reconfirm.

## Evidence

```bash
$ poe-code approvals list --state bogus
No approvals found.
```

## Why it matters

Invalid filter looks empty.

## Suggested direction

Validate state enum.

## Severity

Medium

## Area

Approvals
