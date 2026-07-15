---
severity: medium
impact: discoverability
comment: "Better than it first appears: the undocumented default is not a docs nit, because ux-gaslight-mode-read-still-mutated-plans-dir.md shows archiving happens even when explicitly disabled. Until the behavior is pinned down, documenting the default would document a fiction - so sequence after that Critical and let the documented default describe verified behavior. Its non-TTY rule ('never archive without explicit --archive') is a sound safety default worth adopting."
---

# UX: gaslight/pipeline --archive defaults interaction undocumented

## Summary

Both gaslight and pipeline have --archive and --no-archive but help does not state default archive behavior after success, or interaction with plan archive --yes footguns.

## Evidence

gaslight: --archive / --no-archive
pipeline run: --archive / --no-archive
No default documented.

## Why it matters

Users unsure if plans auto-archive after runs.

## Suggested direction

Document default; never archive without explicit --archive in non-TTY.

## Severity

Medium

## Area

Gaslight / Pipeline
