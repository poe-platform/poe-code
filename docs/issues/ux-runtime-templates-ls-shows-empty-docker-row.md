---
severity: low-medium
impact: polish
comment: "Duplicate of ux-runtime-templates-ls-empty-rows.md; retire into it. Its distinct observation is worth keeping: the empty docker row is ambiguous about whether docker is configured at all, so the placeholder does not merely look odd - it misleads about state."
---

# UX: runtime templates ls shows empty docker placeholder row

## Summary

runtime templates ls includes a docker row with (empty) hash and dashes, plus many old e2b artifacts — noisy and unclear.

## Evidence

```text
│ docker │ (empty) │ - │ - │ - │
│ e2b    │ 0224…   │ … │ … │ 2026-05-04 │
```

## Why it matters

Placeholder empty backend row confuses whether docker is configured.

## Suggested direction

Omit empty backends; default recent e2b; clear guidance.

## Severity

Low–Medium

## Area

Runtime
