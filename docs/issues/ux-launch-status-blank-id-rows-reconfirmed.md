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
