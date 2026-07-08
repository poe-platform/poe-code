# UX: runtime build host no-template message is good (positive)

## Summary

Host runtime has no template to build with pass --runtime e2b/docker or config hint — clear recovery.

## Evidence

```bash
$ poe-code runtime build
■  Host runtime has no template to build. Pass --runtime e2b or --runtime docker, or set "runtime": { "type": "..." } in .poe-code/config.json.
```

## Why it matters

Positive recovery pattern.

## Suggested direction

Keep.

## Severity

Low

## Area

Runtime / positive pattern
