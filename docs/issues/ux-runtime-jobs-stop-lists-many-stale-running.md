---
severity: high
impact: correctness
comment: "Best evidence in the runtime jobs cluster: dozens of jobs reported 'running' with dates spanning weeks, listed as candidates when stop/attach is called without an id. Consolidate with ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md. The zombie state is the root (ux-runtime-jobs-stale-running-zombies.md) and its 'prune dead PIDs' suggestion is the concrete fix - liveness can be checked cheaply on host. Its 'jobs stop --all-stale' idea is a good escape hatch."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/runtime/jobs/shared.ts:43-59 resolveJob lists every state entry with status 'running' unbounded, sorted latest-first, then throws instead of defaulting; packages/poe-code-config/src/state/jobs.ts list() reads job JSON files with no liveness/PID reconciliation, and rg for 'prune|stale|liveness|process.kill' across state and runtime jobs sources returns no matches, so stale 'running' entries persist forever"
---

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
