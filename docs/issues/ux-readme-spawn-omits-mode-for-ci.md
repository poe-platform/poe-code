---
severity: high
impact: discoverability
comment: "Legitimate and High is defensible: README is the highest-traffic surface and its spawn one-liners omit --mode, so the copy-paste path fails non-interactively for the CI audience the examples target. Check against ux-spawn-yes-defaults-mode-to-yolo.md before writing the fix - adding --yes without --mode would make the documented example default to yolo, so the safety callout it asks for is part of the correction rather than garnish."
---

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
