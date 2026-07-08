# UX: code-review profiles prints raw table without design-system panel

## Summary

code-review profiles dumps a minimal ascii table of name/source without Poe panel framing used elsewhere.

## Evidence

```text
┌─────────┬──────────┐
│ name    │ source   │
│ generic │ built-in │
└─────────┴──────────┘
```

## Why it matters

Dual presentation language; toolcraft group.

## Suggested direction

Design-system table + panel.

## Severity

Low–Medium

## Area

Code-review
