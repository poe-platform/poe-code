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
