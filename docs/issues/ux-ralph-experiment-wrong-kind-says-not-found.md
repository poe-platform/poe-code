---
severity: medium
impact: usability
comment: "Contentless but it correctly identifies the cross-command scope: the wrong-kind-as-missing bug spans ralph and experiment, so the fix belongs in shared kind resolution. Retire into ux-experiment-ralph-no-doc-wrong-message.md and the wrong-kind canonical; its value is confirming the pattern is not per-command."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/ralph.ts:467 and src/cli/commands/experiment.ts:645 catch-all rethrow 'doc not found', swallowing kind errors thrown at packages/ralph/src/frontmatter/frontmatter.ts ('must be \"ralph\"') and packages/experiment-loop/src/frontmatter/frontmatter.ts ('kind must be experiment')"
---

# UX: Ralph/experiment wrong kind not found

## Summary

Existing plan wrong kind.

## Evidence

ralph run 32-agent-goal.

## Why it matters

False missing.

## Suggested direction

Wrong kind message.

## Severity

Medium

## Area

Workflows
