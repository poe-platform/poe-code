---
severity: medium
impact: usability
comment: "Keep of this pair as the more interesting finding: 'memory write' with no arguments complains about --reason before mentioning the missing path, so users discover requirements in an order dictated by Commander rather than usage. Same one-at-a-time discovery problem as ux-maestro-tick-missing-transition-raw-commander.md; the shared fix is to collect and report all missing inputs at once."
---

# UX: memory write requires --reason before reporting missing path

## Summary

memory write without args fails on required option --reason before missing path argument — wrong recovery order (flag before path).

## Evidence

```bash
$ poe-code memory write
error: required option '--reason <text>' not specified
```

## Why it matters

Users learn flag order quirks instead of full usage.

## Suggested direction

Collect all missing inputs; show usage memory write <path> --reason ….

## Severity

Medium

## Area

Memory
