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
