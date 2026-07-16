---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/providers/claude-code.ts:118 writes stripModelNamespace(options.model) with no alias resolution or catalog validation, so 'configure --model sonnet' writes literal 'sonnet'; repo-wide rg for 'xhigh|effortLevel' outside docs returns no source hits, so the effortLevel half is not written by poe-code"
comment: "Important incident evidence and the strongest support for the configure-write cluster: live settings contained model 'sonnet' - an unresolved alias, exactly what ux-configure-model-alias-sonnet-haiku-written-literally.md predicts a real configure run would write - together with effortLevel xhigh, which ux-effort-xhigh-valid-for-opus-not-sonnet.md shows is invalid for sonnet. Two dry-run-only findings appear here as actual live corruption, which raises their credibility considerably. Cause is admitted as unproven; pair with ux-claude-settings-model-corrupted-to-fable-restored.md and treat both as the argument for validate-on-write plus a doctor check."
---

# UX: live Claude settings had model sonnet + effortLevel xhigh (restored)

## Summary

During continuous audit status check, ~/.claude/settings.json had model: "sonnet" (unresolved alias from configure --model sonnet dry-run side path or concurrent write) and effortLevel: "xhigh" (invalid for sonnet-4.6). Restored model to claude-sonnet-4-6 and effortLevel to high.

## Evidence

```text
before: model=sonnet, effortLevel=xhigh
after restore: model=claude-sonnet-4-6, effortLevel=high
```
Related: configure alias write + always-xhigh Criticals.

## Why it matters

Live config can be left in broken state by configure footguns; agents fail late.

## Suggested direction

Catalog validate on write; resolve aliases; model-aware effort; doctor check.

## Severity

**High**

## Area

Config / models
