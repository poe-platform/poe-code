---
severity: high
impact: correctness
comment: "Duplicate of ux-launch-start-claims-running-then-status-stopped.md; consolidate into one issue about start not verifying liveness before claiming success, and keep the survivor focused on that single question - both files dilute it with turbo noise that is a dev-mode artefact. Its 'verify process still alive before success; surface exit reason' is the right fix."
---

# UX: launch start reports running then status immediately shows stopped

## Summary

launch start uxsleep2 -- sleep 30 prints Managed process uxsleep2 is running then turbo noise; immediate launch status shows STATUS stopped — race or failed start marked success (extends launch opaque failure / ghost rows).

## Evidence

```bash
$ poe-code launch start uxsleep2 -- sleep 30
# turbo noise…
◆  Managed process uxsleep2 is running.
$ poe-code launch status
│ uxsleep2 │ host │ stopped │ …
```

## Why it matters

False success; users think process is up.

## Suggested direction

Verify process still alive before success; no turbo; surface exit reason.

## Severity

**High**

## Area

Launch
