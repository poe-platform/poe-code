---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- configure claude --skip-if-configured --yes --dry-run prints 'Claude Code default model / anthropic/claude-sonnet-5' then plans full rewrite; src/cli/constants.ts:18 and src/providers/claude-code.ts:64 hardcode the stale default, resolved before the skip check at src/cli/commands/configure.ts:148"
comment: "Duplicate in substance of ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md; retire into it. Its one-line framing is the sharpest in the cluster and should survive: the command 'celebrates configured while advertising broken model' - success framing over a dead value is worse than a plain error."
---

# UX: configure --skip-if-configured shows stale model as default

## Summary

Already-configured path prints anthropic/claude-sonnet-5 as default model though API rejects it.

## Evidence

Claude Code default model anthropic/claude-sonnet-5 + already configured.

## Why it matters

Celebrates configured while advertising broken model.

## Suggested direction

Label configured model; warn if missing from catalog.

## Severity

**High**

## Area

Configure / models
