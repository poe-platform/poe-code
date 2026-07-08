# UX: memory write missing --reason is raw Commander required option

## Summary

memory write without --reason prints raw error: required option '--reason <text>' not specified instead of design-system guidance that reason is required for provenance.

## Evidence

```bash
$ echo hello | poe-code memory write notes/test.md
error: required option '--reason <text>' not specified
```

## Why it matters

Memory provenance is a product concept; missing reason should explain why and show example.

## Suggested direction

Design-system ValidationError with example --reason and init check first if uninitialized.

## Severity

Medium

## Area

Memory
