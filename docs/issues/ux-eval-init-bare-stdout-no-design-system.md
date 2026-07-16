---
severity: medium
impact: polish
comment: "One of four filings of the same eval init bare-stdout observation. Consolidate: ux-eval-init-prints-bare-name-and-cwd-default-confusing.md is the keeper because it adds the location surprise, which is behavioral rather than framing. Retire this one."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-eval/src/cli/init.ts:25-26 writes bare process.stdout.write(relative path) and 'next: poe-code eval check <name>' with no design-system panel or glyph"
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
