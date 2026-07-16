---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/toolcraft/src/suggest.ts:1 exports suggest() with tests at packages/toolcraft/src/suggest.test.ts and Did-you-mean call sites at packages/toolcraft/src/cli.ts:877, mcp.ts:512, sdk.ts:322, index.ts:672; root never imports it - src/cli/program.ts:961-969 default action calls throwCommandNotFound, src/cli/command-not-found.ts:21-25 passes only unknownCommand plus helpCommand into formatCommandNotFoundPanel, and packages/toolcraft-design/src/components/command-errors.ts:4-17 emits label plus hint with no candidate matching, so showSuggestionAfterError(true) at program.ts:857 never fires."
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
