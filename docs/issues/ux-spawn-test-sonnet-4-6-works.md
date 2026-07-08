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
