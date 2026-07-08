# UX: runtime jobs stop without id lists many stale "running" jobs from June

## Summary

runtime jobs stop/attach without job id lists dozens of "running" jobs dating back weeks — zombie job state reconfirmed; unbounded list; See logs.

## Evidence

```bash
$ poe-code runtime jobs stop
■  Error: More than one detached runtime job matches…
│  - … claude-code running 2026-07-08…
│  - … codex running 2026-06-25…
│  - … codex running 2026-06-16…
```

## Why it matters

Users cannot manage jobs; prune/GC urgently needed; strengthens runtime jobs zombie issues.

## Suggested direction

Prune dead PIDs; default most recent; limit list; jobs stop --all-stale.

## Severity

**High**

## Area

Runtime jobs
