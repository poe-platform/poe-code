---
severity: low-medium
impact: usability
comment: "Duplicate within the depth cluster; retire into ux-markdown-read-depth-1-empty-for-h1-only-structure.md. Its question deserves an explicit answer in the survivor: depth 0 is arguably a user error (asking for zero heading levels), so either reject it or define it as 'titles only' - silently returning an empty TOC is the worst of the three options."
reproduced: y
recommendation: no-fix
evidence: "packages/markdown-reader/src/core/read-markdown.ts:24 accepts depth 0 (rejects only depth < 0), then line 32 filters section.depth <= 0 which no heading (min depth 1) matches; probe 'npm run dev -- plan markdown-read docs/issues/ux-markdown-read-depth-zero-empty-sections.md --depth 0' printed 'sections:\n  (none)'. Duplicate of ux-markdown-read-depth-1-empty-for-h1-only-structure.md per existing comment."
---

# UX: plan markdown-read --depth 0 yields empty sections

## Summary

markdown-read --depth 0 prints sections: (none) while file has content — depth 0 means no headings shown without explaining.

## Evidence

sections: (none) for depth 0

## Why it matters

Empty TOC looks broken; document depth semantics.

## Suggested direction

Default unlimited; depth 0 error or show all titles only.

## Severity

Low–Medium

## Area

Plan
