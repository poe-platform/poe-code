---
severity: low-medium
impact: polish
comment: "Part of the unframed-output family; consolidate with the memory and eval framing filings into one design-system consistency decision. Its specific observation is fair - the file:/frontmatter:/sections: block is YAML-ish but not YAML, so it is neither framed for humans nor parseable for machines, the worst of both. That makes its --json ask the better half of the fix."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/plan.ts:215-221 builds terminal output as raw 'file:'/'frontmatter:'/'sections:' lines with no design-system framing; `npm run dev -- plan markdown-read docs/issues/ux-plan-markdown-read-raw-yaml-ish-output.md --depth 1` printed exactly that unframed block. --output json already exists (plan.ts:257-259), so only the framing half remains."
---

# UX: plan markdown-read TOC output is raw unframed structure

## Summary

plan markdown-read prints raw file:/frontmatter:/sections: blocks without design-system framing used by plan view/list.

## Evidence

```text
file: docs/plans/32-agent-goal.md
frontmatter:
  kind: plan
sections:
  1 What we're building
  …
```

## Why it matters

Another dual presentation language inside plan group.

## Suggested direction

Design-system list/table for TOC; --json for machine.

## Severity

Low–Medium

## Area

Plan
