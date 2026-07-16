---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:48 resolvePageRelPath prefixes every show path with pages/, so pages/hello.md resolves but INDEX.md becomes pages/INDEX.md and memory.ts:253 reports 'Page not found'; packages/memory/src/init.ts:17-26 writes INDEX.md at the memory root. Duplicate of ux-memory-show-cannot-open-root-index-file.md."
comment: "The most analytically useful member of the INDEX cluster: it isolates the fault by showing that show works for pages/hello.md and fails for INDEX, proving the store and the reader are both fine and the defect is specifically the root-file namespace. That bisection is what the canonical needs. Retire into ux-memory-show-cannot-open-root-index-file.md, carrying this evidence."
---

# UX: memory show works for user pages but not INDEX (contrast)

## Summary

After write pages/hello.md, memory show pages/hello.md works; memory show INDEX/INDEX.md still fails after init — INDEX path contract broken while user pages OK.

## Evidence

show pages/hello.md works; show INDEX fails (Critical memory INDEX).

## Why it matters

Proves memory store works for pages/; INDEX special-case broken.

## Suggested direction

Fix INDEX/LOG mapping; ls should list pages.

## Severity

**High**

## Area

Memory
