# UX: models --view parameters with provider filter is useful (positive)

## Summary

parameters view for anthropic shows output_effort enums including xhigh — useful for configuring reasoning-effort (which currently ignores values).

## Evidence

models --view parameters --provider anthropic shows output_effort values max, xhigh, high, medium, low, none.

## Why it matters

Positive discovery UI; wire to configure validation.

## Suggested direction

Keep; use enums to validate --reasoning-effort.

## Severity

Low

## Area

Models / positive pattern
