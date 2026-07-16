---
severity: high
impact: security
comment: "Duplicate in substance of ux-configure-dry-run-dumps-entire-existing-agent-config.md (same whole-file rewrite rendering, unconfigure instead of configure); consolidate into the dry-run flood canonical. Its distinct detail is worth carrying: the dump includes the user's hooks, permissions and plugins - content poe-code never wrote - which is the privacy dimension and also why secrets appear in these diffs."
reproduced: y
recommendation: no-fix
evidence: "create-provider.ts:123 runMutations omits dryRun, so apply-mutation.ts:769 configPrune calls writeAtomically (apply-mutation.ts:107) writing a random .mutation-tmp- path; dry-run.ts:88 reads no previous content for that temp path, so renderWriteOperation marks it create and renderUnifiedDiff (dry-run.ts:300) emits the whole ~/.claude/settings.json as + lines; redaction is a fixed key list (dry-run.ts:10-17) that never covers hooks/permissions/plugins content"
---

# UX: unconfigure claude --dry-run dumps full settings including hooks

## Summary

unconfigure claude-code --dry-run shows full settings.json rewrite with hooks, permissions, plugins — not just keys being pruned; large noise; may include secrets in other runs.

## Evidence

unconfigure claude --dry-run → 142-line +settings dump with hooks PreToolUse etc.

## Why it matters

Reconfirm intentional-only dry-run need for unconfigure.

## Suggested direction

Show only pruned keys / restored backup summary.

## Severity

**High**

## Area

Dry-run
