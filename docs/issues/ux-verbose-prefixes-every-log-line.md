---
severity: low-medium
impact: polish
comment: "Contentless but fair: prefixing table rows with '[models]' makes --verbose actively worse for the output it decorates. Note the tension with ux-verbose-spawn-prefix-minimal.md, which finds spawn's verbose prefix unobtrusive - so the problem may be specific to commands that render tables rather than verbose itself. Its 'tag debug only' fix is right: prefix diagnostic lines, not content."
---

# UX: --verbose prefixes every line

## Summary

[models] on tables.

## Evidence

models --verbose.

## Why it matters

Noise.

## Suggested direction

Tag debug only.

## Severity

Low–Medium

## Area

Logging / verbose
