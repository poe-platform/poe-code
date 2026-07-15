---
severity: high
impact: usability
comment: "Duplicate within the kind-unaware cluster; retire into ux-experiment-ralph-no-doc-wrong-message.md - but carry over its evidence, which is the best in the cluster: a side-by-side ls showing many .md files against the 'no markdown doc found' claim, proving the message false."
---

# UX: experiment journal says no markdown under docs/plans despite many plans

## Summary

experiment journal: No markdown doc found under docs/plans. Provide a doc path — false: many plans exist; means no experiment-kind docs but message says no markdown.

## Evidence

```bash
$ poe-code experiment journal
■  No markdown doc found under docs/plans. Provide a doc path.
$ ls docs/plans | head  # many .md files exist
```

## Why it matters

Wrong empty message; should say no experiment docs.

## Suggested direction

No experiment docs in docs/plans. Create one or pass path.

## Severity

**High**

## Area

Experiment
