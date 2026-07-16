---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "npm run dev -- plan markdown-read docs/plans/32-agent-goal.md --depth 2 prints sections 1-6; --output json emits depth/number/title array; src/cli/commands/plan.ts:658"
comment: "Positive pattern and useful as the control case: depth 2 produces exactly the TOC users want on the same document where depth 1 is empty, pinning the problem to depth semantics rather than the reader. Near-duplicate of ux-markdown-read-unlimited-depth-works.md; consolidate. Its --output json evidence is worth keeping - the structured section array is a good machine contract."
---

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
