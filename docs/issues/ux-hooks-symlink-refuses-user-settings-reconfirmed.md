# UX: --hooks-strategy symlink still refuses user-authored settings (reconfirmed)

## Summary

spawn --hooks-from claude-code --hooks-strategy symlink: Refuse to replace user-authored hook file …/.claude/settings.json + See logs.

## Evidence

Refuse to replace user-authored hook file at …/.claude/settings.json

## Why it matters

Reconfirm hooks refuse path; auto strategy same issue.

## Suggested direction

auto should merge/skip; UserError without logs.

## Severity

**High**

## Area

Hooks / spawn
