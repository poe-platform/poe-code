# UX: configure codex --model … dry-run still floods and can leak tokens

## Summary

Reconfirmed: even with explicit --model openai/gpt-5.3-codex, dry-run still dumps large config rewrites (profiles, providers) rather than a short plan of intended changes.

## Evidence

configure codex --model openai/gpt-5.3-codex --yes --dry-run → large + blocks including multiple model_provider entries.

## Why it matters

Strengthens dry-run dump + secret issues with another live path.

## Suggested direction

Intentional-only diff summary.

## Severity

**High**

## Area

Dry-run
