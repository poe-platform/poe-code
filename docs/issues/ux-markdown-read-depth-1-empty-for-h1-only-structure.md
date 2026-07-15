---
severity: medium
impact: usability
comment: "Keep as canonical of the depth cluster: the only file identifying the actual mechanism - depth counts heading levels, so --depth 1 shows nothing on a document whose sections start at h2, which is the normal shape for these plans. That makes 'depth 1 is empty' correct behavior with an unusable default rather than a bug. The fix it and the positives converge on is right: default to unlimited and document depth against heading levels. Absorbs ux-markdown-read-depth-zero-empty-sections.md."
---

# UX: plan markdown-read --depth 1 often shows sections (none)

## Summary

markdown-read --depth 1 on agent-goal plan shows sections (none) because headings may be ## only — depth semantics opaque (related depth 0 empty).

## Evidence

depth 1 → sections: (none) despite multi-section plan.

## Why it matters

Users cannot get TOC without knowing heading levels.

## Suggested direction

Default unlimited depth; document depth vs heading level.

## Severity

Medium

## Area

Plan
