# UX: spawn poe-agent still crashes fs.lstat (reconfirmed live)

## Summary

Live reconfirm: spawn poe-agent "hi" --mode read → fs.lstat is not a function + See logs.

## Evidence

```bash
$ poe-code spawn poe-agent "hi" --mode read
■  Error: fs.lstat is not a function
●  See logs …
```

## Why it matters

Advertised agent remains broken end-to-end.

## Suggested direction

Fix memfs/fs injection; or remove from spawn agent list until fixed.

## Severity

**High**

## Area

Spawn / poe-agent
