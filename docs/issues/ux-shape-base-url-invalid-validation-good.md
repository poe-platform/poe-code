# UX: --shape-base-url invalid format validates cleanly (positive)

## Summary

Invalid --shape-base-url value returns Use <shape-id>=<url> clearly.

## Evidence

```bash
$ poe-code configure claude --shape-base-url "not-an-equals" --yes --dry-run
■  Error: Invalid --shape-base-url value "not-an-equals". Use <shape-id>=<url>.
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep.

## Severity

Low

## Area

Configure / positive pattern
