---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:489-492 throws ValidationError 'spawn requires --mode when running without an interactive TTY' unless --mode or --yes (flags.assumeYes -> yolo, line 485) is given; README.md:72,78-79,85 spawn examples pass neither, and README.md:85 pipes stdin so process.stdin.isTTY is never true there."
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
