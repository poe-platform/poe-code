---
severity: medium
impact: capability-gap
comment: "Reconfirm duplicate; retire into ux-runtime-jobs-ls-help-no-limit-or-since.md. It adds --status to the wish list, worth carrying: given the zombie-running problem, filtering by status is how users would find live jobs."
---

# UX: runtime jobs ls --help has no filters (reconfirmed)

## Summary

runtime jobs ls --help only -h — no --limit, --since, --status despite unbounded May-era list.

## Evidence

runtime jobs ls help: no options beyond -h.

## Why it matters

Reconfirm need for list filters.

## Suggested direction

Add --limit --status --since.

## Severity

Medium

## Area

Runtime jobs
