---
severity: high
impact: correctness
comment: "Incident report for the same event investigated in ux-claude-fable-appears-in-trace-fixtures-not-product-defaults.md; merge into one issue. Evidence is strong on symptom and explicitly unproven on cause. The '[1m]' suffix is the sharpest clue and worth chasing: it looks like an ANSI sequence captured into a value, which suggests something parsed rendered output instead of data. Keep High for the write-validation gap it proves, but do not schedule a fix until the writer is identified."
reproduced: n
recommendation: no-fix
evidence: "Corrupted id absent today; 'fable' occurs only in packages/agent-traces/src/readers/claude.test.ts:296 fixtures; no writer found; write-validation gap already tracked in ux-configure-accepts-any-string-as-model-no-catalog-check.md (src/cli/commands/configure.ts:206 passes model through unvalidated)"
---

# UX: live Claude settings model found corrupted to claude-fable-5[1m] (restored)

## Summary

During audit status check, ~/.claude/settings.json model was claude-fable-5[1m] (invalid id with control-sequence-like suffix). Restored to claude-sonnet-4-6. Source unclear (may be concurrent agent/configure); documents risk of silent garbage model writes.

## Evidence

```text
model: claude-fable-5[1m]
# restored to claude-sonnet-4-6 by audit
```

## Why it matters

Invalid model ids in live config cause late spawn failures; need catalog validation on write.

## Suggested direction

Validate model against catalog on configure write; refuse garbage ids; doctor check.

## Severity

**High**

## Area

Config / models
