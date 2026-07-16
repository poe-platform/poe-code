---
severity: high
impact: usability
comment: "Reconfirm duplicate of ux-ralph-run-plan-kind-says-ralph-doc-not-found.md; retire. Same caveat: its suggested recovery ('Run ralph init first') is currently a dead end because init refuses non-ralph docs."
reproduced: y
recommendation: no-fix
evidence: "packages/ralph/src/frontmatter/frontmatter.ts:182 throws 'kind must be ralph'; ralph.ts:466-467 catch reports 'Ralph doc not found'; probe 'npm run dev -- ralph run docs/plans/32-agent-goal.md --dry-run' printed 'Ralph doc not found: docs/plans/32-agent-goal.md' for an existing file"
---

# UX: ralph run on plan says not found (reconfirmed)

## Summary

ralph run docs/plans/32-agent-goal.md --yes: Ralph doc not found — same wrong-kind class as ralph init.

## Evidence

Ralph doc not found: docs/plans/32-agent-goal.md

## Why it matters

Reconfirm kind-aware errors for ralph run.

## Suggested direction

This is a plan, not a ralph doc. Run ralph init first.

## Severity

**High**

## Area

Ralph
