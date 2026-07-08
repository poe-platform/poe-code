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
