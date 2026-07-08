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
