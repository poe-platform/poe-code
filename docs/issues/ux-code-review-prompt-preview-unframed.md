---
severity: medium
impact: polish
comment: "Same output that ux-code-review-prompt-preview-good.md praises; reconcile the two rather than keeping both - the preview behavior is right, the presentation is unframed. The ask worth keeping is --json for a multi-screen text dump, which makes the output consumable rather than merely prettier."
---

# UX: code-review prompt-preview is unframed long text (toolcraft)

## Summary

code-review prompt-preview dumps long prompt with Prompt preview header and toolcraft identity on help — same unframed class as gh prompt-preview.

## Evidence

prompt-preview --spawn orchestrator prints multi-screen orchestration instructions.

## Why it matters

Hard to scan; no --json.

## Suggested direction

Design-system panel; --json; displayBinaryName.

## Severity

Medium

## Area

Code-review
