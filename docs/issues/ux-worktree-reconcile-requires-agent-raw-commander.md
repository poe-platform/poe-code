---
severity: medium
impact: usability
comment: "Duplicate within the worktree reconcile trio; retire into ux-raw-commander-missing-args.md and the ordering issue above. No distinct content."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/worktree.ts:33 requiredOption('--agent <name>'); `npm run dev -- worktree reconcile foo` prints: error: required option '--agent <name>' not specified"
---

# UX: worktree reconcile missing --agent is raw commander error

## Summary

worktree reconcile missing --yes: error: required option --agent not specified — raw commander; help may list --agent.

## Evidence

error: required option '--agent <name>' not specified

## Why it matters

Design-system ValidationError.

## Suggested direction

ValidationError: --agent is required for reconcile.

## Severity

Medium

## Area

Worktree
