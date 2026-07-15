---
severity: medium
impact: usability
comment: "The decisive file for the did-you-mean cluster and worth keeping despite being terse: suggest.ts already exists and is exercised by toolcraft tests while the root command does not use it, so this is wiring rather than implementation - turning four Medium/High filings into one small change. Its 'wasted fix path' framing is apt. Temper with ux-eval-unknown-command-suggests-lint-for-list.md and ux-runtime-jobs-show-unknown-suggests-stop.md: the existing suggester produces nonsense and even dangerous suggestions, so reuse needs an alias map and a relevance floor."
---

# UX: Toolcraft has suggest; root does not

## Summary

suggest.ts exists; root unused.

## Evidence

toolcraft tests Did you mean.

## Why it matters

Wasted fix path.

## Suggested direction

Reuse suggest at root.

## Severity

Medium

## Area

Errors / recovery
