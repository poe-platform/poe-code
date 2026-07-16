---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/ralph.ts:418 throws 'No markdown doc found under ${planDirectory}. Provide a doc path.' while packages/ralph/src/discovery/discovery.ts:44 filters kinds ['ralph'] and packages/agent-harness-tools/src/plans.ts:159 filters by frontmatter kind, so non-ralph markdown is excluded; behaviour real but duplicate of ux-experiment-ralph-no-doc-wrong-message.md"
comment: "Duplicate within the kind-unaware empty-message cluster; retire into ux-experiment-ralph-no-doc-wrong-message.md, which already covers ralph and experiment together. Its suggested wording is the best in the cluster and should survive: name the kind and point at ralph init."
---

# UX: ralph run empty says no markdown under docs/plans (reconfirmed)

## Summary

ralph run --yes: No markdown doc found under docs/plans — kind-unaware like experiment run despite many plans present.

## Evidence

No markdown doc found under docs/plans. Provide a doc path.

## Why it matters

Reconfirm kind-aware empty message for ralph.

## Suggested direction

No ralph docs found (kind=ralph). Provide path or ralph init.

## Severity

**High**

## Area

Ralph
