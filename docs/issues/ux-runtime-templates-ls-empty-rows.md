# UX: runtime templates ls shows empty hash rows

## Summary

runtime templates ls shows docker and e2b rows with Hash (empty) and blank artifact/Dockerfile/Built — looks like blank-ID table chrome with no useful empty message.

## Evidence

```bash
$ poe-code runtime templates ls
│ docker │ (empty) │ - │ - │ - │
│ e2b    │ (empty) │ - │ - │ - │
```

## Why it matters

Empty cache should say No cached templates rather than empty rows.

## Suggested direction

No local runtime template cache entries. (like clear message)

## Severity

Medium

## Area

Runtime
