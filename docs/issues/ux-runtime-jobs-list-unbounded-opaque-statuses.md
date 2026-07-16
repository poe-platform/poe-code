---
severity: medium
impact: usability
comment: "Contentless but it names both halves of the runtime jobs problem in six words - unbounded history and unexplained statuses. Retire into ux-runtime-jobs-ls-unbounded-may-era-reconfirmed.md, which has the evidence. Its 'can't find current' framing is the real user cost and worth carrying: the list's purpose is finding the active job, which is exactly what it fails at."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/runtime/jobs/ls.ts:14 registers ls with no options; ls.ts:21 calls state.jobs.list() unfiltered, rendering every job with raw entry.status (ls.ts:41); jobs.ts:118 list() applies no limit or recency window"
---

# UX: runtime jobs ls unbounded

## Summary

History dump; lost unexplained.

## Evidence

runtime jobs ls.

## Why it matters

Can't find current.

## Suggested direction

Default recent.

## Severity

Medium

## Area

Runtime
