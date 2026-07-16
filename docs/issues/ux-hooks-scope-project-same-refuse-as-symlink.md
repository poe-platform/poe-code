---
severity: medium
impact: usability
comment: "Third of the four 'refuse to replace' filings; retire into ux-hooks-auto-strategy-still-refuses-user-settings.md. Its useful observation: --hooks-scope project looks like the natural workaround and fails identically, so users try scope, then strategy, and dead-end twice - an argument for the refusal message naming what actually works."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-hook-config/src/bridge-hooks.ts:253 hardcodes symlinkHooks(..., 'project') ignoring opts.scope (scope only used at bridge-hooks.ts:287 transform path), so same-format pairs still hit the throw at packages/agent-hook-config/src/symlink-hooks.ts:167"
---

# UX: --hooks-scope project still refuses user settings (recovery gap)

## Summary

--hooks-from claude-code --hooks-scope project fails same Refuse to replace user-authored hook file — scope does not avoid the refuse path.

## Evidence

```bash
$ poe-code spawn … --hooks-from claude-code --hooks-scope project
■  Error: Refuse to replace user-authored hook file at …/.claude/settings.json
```

## Why it matters

Scope flag looks like a workaround but fails the same way.

## Suggested direction

Document when refuse happens; offer auto strategy that merges without replace.

## Severity

Medium

## Area

Hooks
