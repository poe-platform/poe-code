---
severity: medium
impact: usability
comment: "Duplicate within the markdown-read depth cluster; retire into ux-markdown-read-depth-1-empty-for-h1-only-structure.md, which identifies the heading-level mechanism. Its evidence is the sharpest in the cluster though and should be carried: the same file returns '(none)' from markdown-read --depth 1 while markdown-read-section successfully returns section 1's content, proving the sections exist and only the depth filter hides them. Its 'warn when the filter empties the TOC' idea is a good mitigation for the whole silent-empty-filter family."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- plan markdown-read docs/plans/32-agent-goal.md --depth 1 prints 'Sections: - (none)' while --depth 2 lists sections 1-6 and markdown-read-section '1' returns content; filter is section.depth <= params.depth at packages/markdown-reader/src/core/read-markdown.ts:32 (depth = heading level, plan bodies start at H2)"
---

# UX: plan markdown-read --depth 0/1 can show sections (none) incorrectly

## Summary

plan markdown-read with --depth 1 on a plan whose headings start at depth 2-style numbering may print sections: (none) while section 1 content exists via markdown-read-section — depth filter surprises.

## Evidence

```bash
$ poe-code plan markdown-read docs/plans/32-agent-goal.md --depth 1
sections:
  (none)
$ poe-code plan markdown-read-section … "1"
## 1. What we're building
… content …
```

## Why it matters

Depth filter looks broken for common plan heading styles.

## Suggested direction

Document depth semantics; default depth unlimited; warn when filter empties TOC.

## Severity

Medium

## Area

Plan
