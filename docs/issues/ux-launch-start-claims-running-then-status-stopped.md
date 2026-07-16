---
severity: high
impact: correctness
comment: "One of two filings of the same false-success race; consolidate with ux-launch-start-success-then-status-shows-stopped.md. The core finding is real and worth High: start reports 'is running' while status immediately shows stopped, so success is claimed without verifying the process survived. Its turbo-noise and blank-ID halves belong to the dev-mode and tombstone clusters - split them out so the race is tracked alone."
reproduced: y
recommendation: fix
evidence: "packages/process-launcher/src/supervisor/supervisor.ts:182 transitions state to 'running' immediately after runner.exec with no liveness settle when no readyCheck; packages/process-launcher/src/launcher.ts:140-145 accepts that first non-restarting snapshot as success, so start prints 'is running' for a child that already exited and status then reads stopped/crashed."
---

# UX: launch start claims running but launch status shows stopped zombies

## Summary

launch start sleepjob -- sleep 30 prints Managed process sleepjob is running. Immediately launch status shows sleepjob stopped and leftover rows with ID - stopped. launch start without -- also ran turbo build noise.

## Evidence

```bash
$ poe-code launch start sleepjob -- sleep 30
◆  Managed process sleepjob is running.
$ poe-code launch status
│  sleepjob | host | stopped | exit 0
│  -        | host | stopped | …
```
Also: start without `--` still claimed running after turbo FULL TURBO dump.

## Why it matters

False success + zombie registry rows make launch untrustworthy.

## Suggested direction

Accurate status on start; GC blank-ID rows; fail if process exits immediately; suppress turbo noise.

## Severity

**High**

## Area

Launch
