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
