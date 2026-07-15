---
severity: medium
impact: polish
comment: "One of four filings of the same eval init bare-stdout observation. Consolidate: ux-eval-init-prints-bare-name-and-cwd-default-confusing.md is the keeper because it adds the location surprise, which is behavioral rather than framing. Retire this one."
---

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
