---
severity: medium
impact: discoverability
comment: "Keep as canonical of the five-file login help cluster: the most complete, naming all three gaps (interactive OAuth flow, non-TTY requirements, --yes). The strongest point is the first - login's primary path is the browser OAuth flow and help documents only --api-key, so the default behavior is invisible. Retire the other four into it."
---

# UX: login --help omits interactive OAuth and --yes behavior

## Summary

login help only lists --api-key and -h; does not document interactive OAuth browser flow, non-TTY requirements, or --yes rejection.

## Evidence

```text
Usage: poe-code login [options]
Store a Poe API key for reuse across commands.
Options: --api-key, -h
```

## Why it matters

First-run users need to know login without --api-key opens browser.

## Suggested direction

Document interactive flow, env POE_API_KEY, non-TTY rules.

## Severity

Medium

## Area

Auth / help
