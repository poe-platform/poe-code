# UX: plan with question non-TTY may hang instead of failing fast

## Summary

poe-code plan "improve tests" --yes in non-TTY can hang past 60s rather than ValidationError requiring TTY or agent spawn with explicit mode.

## Evidence

Probe: plan "improve tests" --yes timed out after 60s in non-TTY audit.

## Why it matters

Non-interactive plan drafting must fail fast or run headless with clear mode.

## Suggested direction

Non-TTY: require --agent/--yes policy; fail with Use spawn or provide TTY.

## Severity

**High**

## Area

Plan / non-TTY
