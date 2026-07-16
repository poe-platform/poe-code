---
severity: medium-high
impact: correctness
reproduced: y
recommendation: fix
evidence: "docker-execution-env.ts:869-870 readDetachedExitCode returns null when docker exec fails (container gone), and :676-677 maps null to 'running'; jobs/ls.ts:64-66 reconcileRunningJobs swallows attach errors and re-pushes the stale 'running' entry; no heartbeat/last_seen field exists anywhere in src/ or packages/*/src, and the 'lost' JobStatus is never produced on the detached path."
comment: "Contentless but it names the most consequential runtime defect and gives it the right diagnosis: jobs show 'running' for months because nothing verifies liveness, so the status is fiction. That is a correctness problem rather than a listing nuisance, and it is what makes the ambiguity prompts unusable (ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md). Its 'heartbeat; auto lost' suggestion is the right shape. Same false-status family as ux-launch-start-claims-running-then-status-stopped.md - both trust recorded state over reality."
---

# UX: runtime jobs months-old running

## Summary

running since May.

## Evidence

runtime jobs ls.

## Why it matters

False still executing.

## Suggested direction

Heartbeat; auto lost.

## Severity

Medium–High

## Area

Runtime
