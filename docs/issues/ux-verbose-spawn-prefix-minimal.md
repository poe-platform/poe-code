# UX: --verbose on spawn adds [spawn:claude-code] prefix (low noise)

## Summary

spawn --verbose adds [spawn:claude-code] line before Resume — relatively quiet (related verbose prefixes every log line if worse elsewhere).

## Evidence

●  [spawn:claude-code]
│  Resume: …

## Why it matters

Document verbose behavior; keep low noise.

## Suggested direction

Optional: only show verbose lines when non-empty.

## Severity

Low

## Area

Spawn
