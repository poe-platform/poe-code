# UX: unconfigure goose --dry-run dumps full config rewrite

## Summary

unconfigure goose --dry-run creates large full config.yaml + dump rather than intentional-only removal summary — dry-run flood class.

## Evidence

unconfigure goose --dry-run → full +config.yaml with many extensions.

## Why it matters

Reconfirm dry-run dump noise.

## Suggested direction

Intentional-only diff; summarize preserved extensions.

## Severity

Medium

## Area

Dry-run
