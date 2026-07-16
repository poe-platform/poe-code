---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "claude-fable-* exists only in test fixtures (packages/agent-traces/src/readers/claude.test.ts:296,881) and docs/plans/archive/agent-trace-viewer.md; FRONTIER_MODELS (src/cli/constants.ts:1-7) and all non-test src/packages code contain no fable id, so product ships no bad default - this is an investigation note, and the write-validation ask is canonical in ux-configure-accepts-any-string-as-model-no-catalog-check.md"
comment: "Investigation note paired with ux-claude-settings-model-corrupted-to-fable-restored.md; together they are the useful half of the fable incident and should merge. The finding that clears product code matters: claude-fable-5 exists only in agent-traces fixtures and archived plans, not in FRONTIER_MODELS, so this is not a shipped bad default. But the cause of the live write is unproven, so the residue is defensive rather than corrective - validate model ids against the catalog on settings write, plus a doctor check. Do not close as 'fixtures only'; the corruption was real."
---

# UX: claude-fable-* appears in agent-traces test fixtures (note)

## Summary

claude-fable-5 appears in packages/agent-traces test fixtures and archived plans as fixture model ids. Live settings corruption to claude-fable-5[1m] may come from concurrent agent/trace activity writing settings, not product FRONTIER_MODELS. Still need protect live config from garbage writes.

## Evidence

packages/agent-traces/src/readers/claude.test.ts uses model: "claude-fable-5"
Live settings intermittently became claude-fable-5[1m] + xhigh during audit.

## Why it matters

Sources of live model corruption may include concurrent agents writing settings; product must validate on write and doctor should detect.

## Suggested direction

Validate model on settings write; doctor; never write fixture ids to live config.

## Severity

**High**

## Area

Config / models
