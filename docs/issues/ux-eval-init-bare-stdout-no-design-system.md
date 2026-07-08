# UX: eval init prints bare name and next on stdout without design system

## Summary

eval init demo -C /tmp prints only: demo / next: poe-code eval check demo — no panel, no success glyph framing; help uses npm run dev.

## Evidence

```bash
$ poe-code eval init demo -C /tmp/…
demo
next: poe-code eval check demo
```

## Why it matters

Inconsistent with design-system CLI elsewhere.

## Suggested direction

Use design-system success panel; displayBinaryName=poe-code.

## Severity

Medium

## Area

Eval
