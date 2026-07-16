---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "launcher.ts:801-822 listIds() returns any non-file entry under baseDir as an id, and readManagedProcess returns spec=null/state=null when spec.json and state.json are absent; launch.ts:615 formatStatusRow then falls back to ID '-' with RUNTIME host, STATUS stopped, PID/UPTIME/LAST EXIT '-', RESTARTS 0 - exactly the reported row. Duplicate of ux-launch-status-blank-id-rows-reconfirmed.md (already reproduced=y, recommendation=fix)."
comment: "Third filing of the blank-ID rows; retire into the consolidated blank-ID issue. Its detail that '-' cannot easily be removed is the practical sting and connects to ux-launch-status-crashes-on-tombstone-dirs.md, where rm leaves state that breaks listing - the two may share one root."
---

# UX: launch status can show ghost rows with ID "-"

## Summary

After failed/removed processes, launch status may show a table row with ID "-", STATUS stopped, empty metrics — a ghost entry that confuses cleanup.

## Evidence

```text
│ ID │ RUNTIME │ STATUS  │ PID │ RESTARTS │ UPTIME │ LAST EXIT │
│ -  │ host    │ stopped │ -   │ 0        │ -      │ -         │
```

## Why it matters

Looks like data corruption; users cannot rm "-" easily.

## Suggested direction

Filter invalid/empty ids from list; auto-prune corrupt state; never display dash id.

## Severity

**High**

## Area

Launch
