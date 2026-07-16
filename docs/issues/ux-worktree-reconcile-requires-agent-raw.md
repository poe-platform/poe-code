---
severity: medium
impact: usability
comment: "Third duplicate within the worktree reconcile trio; retire. Its --yes-not-in-help aside belongs to the global-flags family."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/worktree.ts:33 requiredOption('--agent <name>'); `npm run dev -- worktree reconcile --yes` prints \"error: required option '--agent <name>' not specified\" and --help omits --yes"
---

# UX: worktree reconcile requires --agent via raw commander

## Summary

worktree reconcile missing --yes fails required option --agent not specified (raw) before not-found; --yes not in help.

## Evidence

error: required option '--agent <name>' not specified

## Why it matters

Validation order and raw commander on worktree.

## Suggested direction

Design-system ValidationError; optional agent default; document --yes.

## Severity

Medium

## Area

Worktree
