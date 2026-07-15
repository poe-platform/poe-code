---
severity: high
impact: usability
comment: "One of four filings of blank-ID rows in launch status; consolidate. Before scheduling, read ux-launch-start-via-npm-run-dev-confuses-argv.md: the audit's own multi-line shell invocations produced malformed process ids, a plausible cause of these rows - so the registry may be faithfully recording garbage the audit created. Strict id validation addresses the cause; GC for blank rows may be treating a symptom only the harness produced."
---

# UX: launch status shows blank ID rows (reconfirmed)

## Summary

launch status table has multiple rows with ID "-" STATUS stopped — blank-ID zombie rows pollute status (related runtime jobs blank ID).

## Evidence

```bash
$ poe-code launch status
│  ID  │ RUNTIME │ STATUS  │
│  -   │ host    │ stopped │
│  -   │ host    │ stopped │
│  -   │ host    │ stopped │
```

## Why it matters

Reconfirm launch/runtime GC blank-ID rows.

## Suggested direction

GC blank IDs; hide invalid rows; launch rm --all-stale.

## Severity

**High**

## Area

Launch
