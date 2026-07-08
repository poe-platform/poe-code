# UX: gaslight --model "" falls back to dead claude-sonnet-5

## Summary

gaslight … --model "" still runs Implement prompt and fails API Error: Unsupported model: claude-sonnet-5 with success glyphs then failure — empty model ignored; dead default used.

## Evidence

```bash
$ poe-code gaslight docs/plans/README.md --mode read --yes --model ""
✓ agent: API Error: 400 Unsupported model: 'claude-sonnet-5'.
■  Gaslight round 1 failed …
```

## Why it matters

Empty model + dead default cluster collision; success glyphs on failure.

## Suggested direction

Reject empty --model; never default to sonnet-5; no ✓ on failure.

## Severity

**Critical**

## Area

Gaslight / models
