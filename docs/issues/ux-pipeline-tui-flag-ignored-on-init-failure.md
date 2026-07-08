# UX: pipeline --tui does not change failure UX when init fails immediately

## Summary

pipeline run --tui still shows non-dashboard failure path with success markers and Problems-before-error when model init fails, so --tui appears ignored on the common failure path.

## Evidence

```bash
$ poe-code pipeline run --yes --tui --plan docs/plans/23-toolcraft-yaml-output.md
✓ agent: API Error: 400 Unsupported model…
■  Error: Pipeline initialization failed…
```

## Why it matters

Users pass --tui expecting dashboard; get same broken markers UX.

## Suggested direction

Preflight model before TUI; or open dashboard with error state; fix success markers.

## Severity

Medium

## Area

Pipeline / TUI
