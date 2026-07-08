# UX: update --package-manager pnpm works (positive)

## Summary

update --package-manager pnpm --dry-run plans pnpm add -g poe-code@latest — positive package manager override (still always -g).

## Evidence

update --package-manager pnpm --dry-run → pnpm add -g poe-code@latest

## Why it matters

Positive override; still global-only.

## Suggested direction

Keep; fix global assumption separately.

## Severity

Low

## Area

Update / positive pattern
