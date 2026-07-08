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
