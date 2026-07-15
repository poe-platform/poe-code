---
severity: high
impact: correctness
comment: "Important and correctly High: three surfaces give three answers for the same safety-critical default - SDK yolo, spawn --yes yolo, gaslight auto - so the blast radius of an unspecified mode depends on which entry point you use. Read with ux-permission-mode-sets-differ-across-commands.md (four different choice sets) this is one problem: permission mode has no single definition. The repo's own CLI/SDK parity rule makes it a clear defect rather than a judgement call. Its 'prefer safe library default' instinct is right - a library defaulting to yolo is the worst of the three."
---

# UX: SDK and CLI disagree on default permission mode

## Summary

SDK defaults mode to yolo; CLI spawn prompts/--yes yolo; gaslight defaults auto.

## Evidence

SDK JSDoc default yolo; spawn help --yes uses yolo; gaslight default auto.

## Why it matters

Safety default product decision; three answers.

## Suggested direction

One policy matrix; prefer safe library default.

## Severity

**High**

## Area

SDK / safety
