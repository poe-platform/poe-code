---
severity: high
impact: usability
comment: "Keep as canonical of the kind-unaware empty-message cluster: the only filing spanning both experiment and ralph, which proves the defect lives in the shared doc-discovery layer rather than one command, and it carries the ls evidence showing the message is factually false. Absorbs the experiment journal/run/validate twins. Fix once: name the kind that was filtered for and how to create such a doc."
reproduced: y
recommendation: fix
evidence: "npm run dev -- experiment validate printed 'No markdown doc found under docs/plans. Provide a doc path.' while docs/plans holds 13 .md files (kinds plan/pipeline only); src/cli/commands/experiment.ts:601 and src/cli/commands/ralph.ts:418 emit the kind-unaware text, and discovery filters kinds at packages/experiment-loop/src/discovery/discovery.ts:34, packages/ralph/src/discovery/discovery.ts:44, packages/agent-harness-tools/src/plans.ts:159"
---

# UX: experiment/ralph no-doc says no markdown under docs/plans despite many plans

## Summary

experiment validate/journal and ralph run without doc say No markdown doc found under docs/plans. Provide a doc path even though docs/plans has many markdown files — filter is kind-specific but message implies empty directory.

## Evidence

```bash
$ poe-code experiment validate
■  No markdown doc found under docs/plans. Provide a doc path.
$ ls docs/plans/*.md | wc -l  # many files exist
```

## Why it matters

Message is false/misleading; should say no experiment/ralph docs or list how to create.

## Suggested direction

No experiment markdown found (kind: experiment). Create with experiment install or pass path.

## Severity

**High**

## Area

Experiment / Ralph
