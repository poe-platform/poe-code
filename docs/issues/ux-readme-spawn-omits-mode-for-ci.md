# UX: README spawn examples omit non-TTY --mode

## Summary

README CI spawn one-liners omit --mode/--yes; fail non-interactively.

## Evidence

README spawn codex "Say hello"; actual requires --mode.

## Why it matters

Front-page broken for CI audience.

## Suggested direction

Update examples with --mode/--yes + safety callout.

## Severity

**High**

## Area

Docs / CI
