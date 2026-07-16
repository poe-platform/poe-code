---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- code-review prompt-preview --spawn orchestrator printed 'Prompt preview' with Spawn/Profile/Prompt rows; packages/agent-code-review/src/prompt-preview.ts:47 previewCodeReviewSpawnPrompt only reads/builds prompts, and cli.ts:135 declares 'without side effects'"
comment: "Positive pattern; the useful half is the principle - prompt-preview shows what would happen with no side effects, which is exactly the dry-run shape ux-code-review-install-no-dry-run-force-writes.md lacks. Cite it there as the in-product precedent. Note it contradicts ux-code-review-prompt-preview-unframed.md, which calls the same output hard to scan: reconcile as behavior good, framing not."
---

# UX: code-review prompt-preview is useful (positive)

## Summary

code-review prompt-preview --spawn orchestrator prints Spawn/Profile/Prompt preview without side effects — good dry-run style.

## Evidence

prompt-preview → Prompt preview with orchestration flow text.

## Why it matters

Positive preview pattern.

## Suggested direction

Keep; design-system frame; displayBinaryName.

## Severity

Low

## Area

Code-review / positive pattern
