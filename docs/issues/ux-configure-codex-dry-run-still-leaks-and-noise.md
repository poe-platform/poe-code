---
severity: high
impact: security
comment: "Third codex flood filing, rated High only because it fuses the secret leak with the noise - which is precisely why it sits at High while its Medium twins describe the same flood. Split them: the leak belongs to the Critical cluster (ux-dry-run-diffs-print-secrets.md), the noise to the flood cluster. Retire after splitting."
---

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
