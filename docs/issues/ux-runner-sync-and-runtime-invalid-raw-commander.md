# UX: invalid --runner-sync/--runtime use raw Commander choice errors

## Summary

Invalid --runner-sync bogus and --runtime bogus print Commander option argument is invalid. Allowed choices… without design-system framing (unlike --mode).

## Evidence

```bash
$ poe-code spawn … --runner-sync bogus
error: option '--runner-sync <mode>' argument 'bogus' is invalid. Allowed choices are both, upload, none.
$ poe-code spawn … --runtime bogus
error: option '--runtime <runtime>' argument 'bogus' is invalid. Allowed choices are host, docker, e2b.
```

## Why it matters

Inconsistent enum validation skins on same command.

## Suggested direction

Use ValidationError like --mode.

## Severity

Medium

## Area

Spawn
