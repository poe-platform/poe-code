# UX: --skip-if-configured help says exit without writes when config matches but behavior differs

## Summary

Help: Exit without writes when current config already matches. Observed: --skip-if-configured --yes rewrote dead sonnet-5; --skip-if-configured --dry-run still plans full rewrite even when model matches.

## Evidence

```text
--skip-if-configured  Exit without writes when current config already matches
```
Live: rewrote config; dry-run plans full create.

## Why it matters

Help text is false advertising for a safety flag.

## Suggested direction

Implement true match-and-skip; dry-run reports would skip; never write dead defaults.

## Severity

**Critical**

## Area

Configure / help
