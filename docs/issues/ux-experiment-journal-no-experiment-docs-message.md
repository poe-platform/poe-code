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
