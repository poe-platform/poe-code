# UX: usage list --pages 0 uses raw Commander integer error

## Summary

--pages 0/-1 prints error: option argument is invalid. Expected a positive integer without design-system framing.

## Evidence

```bash
$ poe-code usage list --pages 0
error: option '--pages <count>' argument '0' is invalid. Expected a positive integer.
```

## Why it matters

Inconsistent validation skin.

## Suggested direction

ValidationError design-system message.

## Severity

Medium

## Area

Usage
