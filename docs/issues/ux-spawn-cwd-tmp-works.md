# UX: spawn -C /tmp works (positive)

## Summary

spawn with -C /tmp succeeds; Resume line shows cd /tmp && claude --resume — cwd override works.

## Evidence

spawn … -C /tmp → ✓ agent; Resume: cd /tmp && claude --resume …

## Why it matters

Positive cwd override.

## Suggested direction

Keep.

## Severity

Low

## Area

Spawn / positive pattern
