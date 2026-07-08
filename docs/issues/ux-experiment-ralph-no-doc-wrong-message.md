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
