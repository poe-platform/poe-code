---
severity: high
impact: security
comment: "Duplicate in substance of ux-configure-dry-run-dumps-entire-existing-agent-config.md (same whole-file rewrite rendering, unconfigure instead of configure); consolidate into the dry-run flood canonical. Its distinct detail is worth carrying: the dump includes the user's hooks, permissions and plugins - content poe-code never wrote - which is the privacy dimension and also why secrets appear in these diffs."
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
