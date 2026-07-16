---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:222 prints 'No memory pages yet.' when packages/memory/src/pages.ts:14-15 listPages finds no markdown under MEMORY_PAGES_DIR_RELPATH; packages/memory/src/init.ts:23-26 creates empty pages/ plus root INDEX.md and LOG.md, which packages/memory/src/ingest.ts:139 treats as non-pages by design, so the empty state is accurate and no defect exists here"
comment: "Positive pattern, but its own caveat undercuts the praise: 'No memory pages yet' is only clear if INDEX is genuinely not a page - and ux-memory-show-cannot-open-root-index-file.md shows init created INDEX.md and LOG.md that ls refuses to acknowledge. So this message is arguably the Critical bug's symptom rather than a good empty state. Consolidate into the memory empty-state note and link the Critical."
---

# UX: memory ls empty message is good (positive)

## Summary

memory ls after init: No memory pages yet — clear empty state.

## Evidence

No memory pages yet.

## Why it matters

Positive empty list.

## Suggested direction

Keep; ensure INDEX visible if intended as page.

## Severity

Low

## Area

Memory / positive pattern
