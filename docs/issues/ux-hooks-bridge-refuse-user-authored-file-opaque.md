---
severity: medium
impact: usability
comment: "One of four 'refuse to replace' filings; retire into ux-hooks-auto-strategy-still-refuses-user-settings.md, which identifies the actual bug. Its distinct contribution is the best statement of the recovery gap - the refusal is safe but terminal, never saying why it refused or what to try - and that copy fix is still needed after auto is corrected."
reproduced: y
recommendation: fix
evidence: "packages/agent-hook-config/src/symlink-hooks.ts:167 throws plain Error('Refuse to replace user-authored hook file at ...') with no recovery guidance; bridge-hooks.ts:253 calls it on the symlink path and src/cli/bootstrap.ts:77 renders plain Errors as 'See logs at .../errors.log'"
---

# UX: Hook bridge “Refuse to replace user-authored hook file” is opaque

## Summary

spawn with --hooks-from/--hooks-scope can fail with Refuse to replace user-authored hook file at …/settings.json without explaining how to proceed (different scope, strategy, or backup).

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --hooks-from claude-code --hooks-scope project
■  Error: Refuse to replace user-authored hook file at …/.claude/settings.json
●  See logs …
```

## Why it matters

Power feature dead-ends without recovery; safety refusal needs next steps.

## Suggested direction

Explain why refused; suggest --hooks-strategy, scope change, or manual merge docs; ValidationError without errors.log.

## Severity

Medium

## Area

Hooks / spawn
