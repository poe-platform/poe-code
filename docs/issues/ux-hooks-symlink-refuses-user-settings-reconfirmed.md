---
severity: high
impact: usability
comment: "Reconfirm duplicate in the 'refuse to replace' cluster with no new evidence; retire into ux-hooks-auto-strategy-still-refuses-user-settings.md. Five filings of one refusal path is count inflation - and its own note that auto has the same issue is the actual finding, which the auto file already owns."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-hook-config/src/symlink-hooks.ts:167 throws plain Error('Refuse to replace user-authored hook file at ...'); bridge-hooks.ts:236 defaults same-format pairs to symlink; src/cli/bootstrap.ts:70-78 renders plain Errors as 'Error: ...' plus 'See logs at .../errors.log'. Behaviour real but already owned by ux-hooks-auto-strategy-still-refuses-user-settings.md"
---

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
