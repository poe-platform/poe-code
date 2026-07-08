# UX: memory clear requires --yes non-TTY but help omits --yes

## Summary

memory clear non-TTY after init: memory clear requires --yes — good policy; memory clear --help only -h, no --yes or blast radius.

## Evidence

```bash
$ poe-code memory clear
■  memory clear requires --yes when running without an interactive TTY.
$ poe-code memory clear --help
Options: -h only
```

## Why it matters

Destructive clear help incomplete; policy good.

## Suggested direction

Document --yes; Delete all memory pages; requires --yes non-TTY.

## Severity

**High**

## Area

Memory / destructive
