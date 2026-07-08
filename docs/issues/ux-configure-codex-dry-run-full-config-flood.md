# UX: configure codex --dry-run floods full multi-profile config

## Summary

configure codex --model openai/gpt-5.3-codex --yes --dry-run dumps large multi-profile config with migrations and unrelated project paths — dry-run flood class.

## Evidence

dry-run includes many project profiles, model_migrations, kindle-alpha, gpt migrations…

## Why it matters

Users cannot see intentional changes for this configure call.

## Suggested direction

Intentional-only diff of active profile + model.

## Severity

Medium

## Area

Dry-run
