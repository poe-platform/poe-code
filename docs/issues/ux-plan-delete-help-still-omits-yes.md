# UX: plan delete --help still omits --yes (reconfirmed)

## Summary

plan delete help only path, --kind, --output, -h — no --yes despite non-TTY requiring it.

## Evidence

plan delete Options: --kind, --output, -h only.

## Why it matters

Reconfirm destructive help gap.

## Suggested direction

Document --yes; require path non-TTY.

## Severity

**High**

## Area

Plan / destructive
