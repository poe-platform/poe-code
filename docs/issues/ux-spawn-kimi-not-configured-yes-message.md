# UX: spawn kimi not configured message mentions --yes oddly

## Summary

spawn kimi without configure: Kimi is not configured via poe. Pass --yes to proceed without prompting — unclear what --yes does (skip configure? force spawn?).

## Evidence

```bash
$ poe-code spawn kimi "say only: ok" --mode read
■  Kimi is not configured via poe. Pass --yes to proceed without prompting.
```

## Why it matters

Recovery path unclear; should say configure kimi or install.

## Suggested direction

Run poe-code configure kimi; or --yes meaning proceed unconfigured documented.

## Severity

**High**

## Area

Spawn / kimi
