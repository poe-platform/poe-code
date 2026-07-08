# UX: plan markdown-read --depth 2 shows TOC well (positive)

## Summary

plan markdown-read --depth 2 prints numbered sections 1–6 for agent-goal plan; --output json includes depth/number/title structure.

## Evidence

```bash
$ poe-code plan markdown-read docs/plans/32-agent-goal.md --depth 2
sections:
  1 What we're building
  …
$ poe-code plan markdown-read … --output json
# structured sections array
```

## Why it matters

Positive TOC UX when depth is appropriate (contrast depth 1 empty).

## Suggested direction

Keep; default unlimited depth; document depth vs heading levels.

## Severity

Low

## Area

Plan / positive pattern
