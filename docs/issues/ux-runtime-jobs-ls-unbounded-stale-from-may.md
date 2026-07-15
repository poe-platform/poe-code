---
severity: high
impact: usability
comment: "Duplicate of ux-runtime-jobs-ls-unbounded-may-era-reconfirmed.md; retire into it. Its --json ask is worth carrying to the --json family since an unbounded table is exactly where machine output helps most."
---

# UX: runtime jobs ls is unbounded with jobs from May (reconfirmed)

## Summary

runtime jobs ls shows huge table including pending e2b jobs and exited host jobs from 2026-05-04 with no --limit/--since — reconfirm unbounded opaque statuses.

## Evidence

runtime jobs ls → many rows from May 2026, pending e2b without started times.

## Why it matters

Unusable job history; no GC.

## Suggested direction

Default recent 20; --all; prune pending zombies; --json.

## Severity

**High**

## Area

Runtime jobs
