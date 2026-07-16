---
severity: medium
impact: usability
comment: "Instance of the raw-Commander invalid-choice family; retire into ux-raw-commander-invalid-option-choices.md. Its evidence is the strongest in that family and worth carrying: two flags on the same command as --mode fall through to Commander while --mode gets design-system framing, so the inconsistency lives within a single command's own option set."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/runtime-options.ts:13-24 uses Commander Option.choices() for --runtime and --runner-sync, while spawn's --mode throws design-system ValidationError at src/cli/commands/spawn.ts:535; both flags land on spawn via addRuntimeOptions (src/cli/commands/spawn.ts:140). Duplicate of docs/issues/ux-raw-commander-invalid-option-choices.md."
---

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
