# UX: configure codex --dry-run still floods multi-profile config (reconfirm)

## Summary

configure codex --model openai/gpt-5.3-codex --yes --dry-run still dumps many profile/migration lines (gpt migrations, iris-alpha, multiple projects) — dry-run flood class reconfirm.

## Evidence

dry-run includes many +model_migrations, project paths, gpt-5.5 profiles…

## Why it matters

Reconfirm intentional-only dry-run needed for codex.

## Suggested direction

Show only intentional model/provider changes for this call.

## Severity

Medium

## Area

Dry-run
