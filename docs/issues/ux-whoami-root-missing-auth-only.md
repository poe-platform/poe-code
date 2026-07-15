---
severity: medium
impact: discoverability
comment: "Part of the missing-root-verb trio with 'version' and 'help'; consolidate into one aliasing change. Its case is the strongest of the three: whoami is a standard identity verb, auth whoami already works and returns clean JSON (ux-auth-whoami-field-shape-good.md), so a root alias is trivial. Its npm run dev half belongs to the identity cluster."
---

# UX: whoami only under auth, root whoami missing

## Summary

whoami at root → Unknown command + npm run dev; auth whoami works as JSON. Users expect top-level whoami.

## Evidence

```bash
$ poe-code whoami
■  Unknown command: whoami
$ poe-code auth whoami
{"user_id":…,"handle":"kamil",…}
```

## Why it matters

Discoverability; npm run dev recovery.

## Suggested direction

Root alias whoami → auth whoami; displayBinaryName.

## Severity

Medium

## Area

Auth / help
