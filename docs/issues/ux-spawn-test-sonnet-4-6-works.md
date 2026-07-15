---
severity: low
impact: none
comment: "The most useful of the spawn-works positives because it states the conclusion the sonnet-5 cluster needs: the live model succeeds when passed explicitly, so the only thing wrong is the default. Keep and link from ux-constants-source-of-dead-sonnet-5.md - it is the proof that the one-line constants change is sufficient rather than merely necessary."
---

# UX: spawn/test with sonnet-4.6 work (positive contrast to defaults)

## Summary

spawn and test claude with anthropic/claude-sonnet-4.6 succeed — live model works when explicitly passed; defaults do not use it.

## Evidence

spawn/test claude --model anthropic/claude-sonnet-4.6 → success.

## Why it matters

Positive proof default should be sonnet-4.6 not sonnet-5.

## Suggested direction

Set default to sonnet-4.6.

## Severity

Low

## Area

Configure / positive pattern
