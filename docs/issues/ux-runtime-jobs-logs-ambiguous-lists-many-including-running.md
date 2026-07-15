---
severity: high
impact: usability
comment: "Good filing and fair-minded: it credits the ambiguity error as the right idea and identifies the two things that ruin it - the candidate list is unbounded and it includes zombie 'running' jobs from earlier experiments, so the disambiguation prompt is itself unusable. Consolidate with ux-runtime-jobs-stop-lists-many-stale-running.md (same defect via stop/attach). Its fix list is the best in the cluster: default to most recent, cap the list, prune stale, drop the log tease."
---

# UX: runtime jobs logs without id dumps long ambiguous job list including running zombies

## Summary

runtime jobs logs without jobId errors with More than one … Pass a job id and lists many jobs including running ones that may be stale from earlier detach experiments — reaffirms unbounded jobs list + zombie running.

## Evidence

```bash
$ poe-code runtime jobs logs
■  Error: More than one detached runtime job matches this command. Pass a job id.
│  - 01KX… claude-code exited …
│  - 01KW… claude-code running …
●  See logs …
```

## Why it matters

Ambiguity error is good idea but list is unbounded and includes zombie running; See logs unnecessary.

## Suggested direction

Default to most recent; limit list to 5; prune stale running; ValidationError without logs.

## Severity

**High**

## Area

Runtime jobs
