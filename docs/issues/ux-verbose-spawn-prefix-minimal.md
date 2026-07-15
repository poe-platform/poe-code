---
severity: low
impact: none
comment: "Useful counterweight to ux-verbose-prefixes-every-log-line.md: spawn's verbose prefix is a single unobtrusive line, so verbose is not uniformly noisy - the damage is where it decorates tables. Read together they scope the fix precisely: prefix diagnostics, leave rendered content alone. Its suggestion to suppress empty verbose lines is a small real nit."
---

# UX: --verbose on spawn adds [spawn:claude-code] prefix (low noise)

## Summary

spawn --verbose adds [spawn:claude-code] line before Resume — relatively quiet (related verbose prefixes every log line if worse elsewhere).

## Evidence

●  [spawn:claude-code]
│  Resume: …

## Why it matters

Document verbose behavior; keep low noise.

## Suggested direction

Optional: only show verbose lines when non-empty.

## Severity

Low

## Area

Spawn
