---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/configure.ts:148-156 short-circuits on skipIfConfigured via hasMaterialConfigureChange; configure.ts:270-271 emits 'Dry run: <label> is already configured.'; skip path is agent-agnostic (overlay.hasMaterialChange at configure.ts:324), not cursor-specific"
comment: "Decisive positive for the skip-if-configured cluster: it proves the truthful skip path exists and works for cursor ('Dry run: Cursor is already configured; no filesystem changes'), which makes the claude path's failure to short-circuit an inconsistency rather than an unimplemented feature. That materially lowers the cost of the Critical fixes - the behavior only needs propagating. Keep and link from ux-skip-if-configured-help-text-lies.md."
---

# UX: configure cursor --skip-if-configured dry-run says already configured (positive)

## Summary

configure cursor --model haiku --skip-if-configured --yes --dry-run: Dry run: Cursor is already configured; no filesystem changes — skip works for cursor when already configured (contrast claude still full rewrite).

## Evidence

```bash
$ poe-code configure cursor --model anthropic/claude-haiku-4.5 --skip-if-configured --yes --dry-run
●  Dry run: Cursor is already configured.
●  # no filesystem changes
```

## Why it matters

Positive truthful skip path exists for some agents; claude path still lies.

## Suggested direction

Apply same short-circuit to claude-code configure.

## Severity

Low

## Area

Configure / positive pattern
