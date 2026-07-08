# UX: configure --base-url override not visible in dry-run

## Summary

configure --base-url https://example.invalid --yes --dry-run still shows ANTHROPIC_BASE_URL https://api.poe.com — override not reflected in dry-run (related shape-base-url opacity).

## Evidence

--base-url example.invalid dry-run still +ANTHROPIC_BASE_URL api.poe.com

## Why it matters

Users cannot verify base URL override from dry-run.

## Suggested direction

Show effective base URL in intentional dry-run.

## Severity

**High**

## Area

Configure / dry-run
