---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/memory.ts:556-559 enforces requireInteractiveStdin without --yes; --yes is only a global option (src/cli/program.ts:852) and showGlobalOptions is off, so `npm run dev -- memory clear --help` prints 'Options: -h, --help' only"
comment: "Keep as canonical of the memory clear cluster: the only filing pairing both facts - the --yes guard is enforced non-TTY and help documents neither --yes nor the blast radius - which is the accurate framing the other five miss. It also settles the contradiction with ux-memory-clear-no-yes-no-dry-run.md in favour of the guard existing. Remaining asks: a help fix and --dry-run."
---

# UX: memory clear requires --yes non-TTY but help omits --yes

## Summary

memory clear non-TTY after init: memory clear requires --yes — good policy; memory clear --help only -h, no --yes or blast radius.

## Evidence

```bash
$ poe-code memory clear
■  memory clear requires --yes when running without an interactive TTY.
$ poe-code memory clear --help
Options: -h only
```

## Why it matters

Destructive clear help incomplete; policy good.

## Suggested direction

Document --yes; Delete all memory pages; requires --yes non-TTY.

## Severity

**High**

## Area

Memory / destructive
