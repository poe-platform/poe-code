# UX: auth api-key --help has no danger note or mask flag

## Summary

auth api-key help: Display stored API key; Options only -h — no --mask, no danger that it prints full secret (Critical #3).

## Evidence

```text
Display stored API key.
Options: -h only
```

## Why it matters

Help must warn before users run secret reveal.

## Suggested direction

Danger: prints full secret. Prefer --mask default; --reveal opt-in.

## Severity

**High**

## Area

Auth / security
