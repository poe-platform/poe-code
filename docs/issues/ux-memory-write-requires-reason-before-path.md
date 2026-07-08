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
