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
