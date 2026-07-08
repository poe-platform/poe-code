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
