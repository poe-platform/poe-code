---
severity: high
impact: usability
comment: "Duplicate of ux-hooks-from-codex-to-claude-transform-unsupported.md; retire into it. Both make the same correct and important point: --hooks-from accepts codex, so the unsupported pair is only discovered after the run starts. Validate the source/target matrix at parse time."
---

# UX: hooks-from codex→claude still not supported yet

## Summary

spawn --hooks-from codex: Transforming hooks from "codex" is not supported yet + See logs — late failure after help advertises hooks-from.

## Evidence

Transforming hooks from "codex" is not supported yet

## Why it matters

Reconfirm hooks source→target matrix; should validate at flag parse.

## Suggested direction

Capability matrix; reject unsupported pairs early without See logs.

## Severity

**High**

## Area

Hooks / spawn
