---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/program.ts:81-101 ROOT_HELP_COMMAND_SPECS omits skill and memory; `npm run dev -- --help` lists neither, while `npm run dev -- skill --help` and `npm run dev -- memory --help` both print help. Duplicate of ux-root-help-hides-skill-memory-runtime-eval-and-more.md."
comment: "Duplicate within the root help discoverability cluster; retire into ux-root-help-hides-skill-memory-runtime-eval-and-more.md. Its evidence method is the cleanest of the group (grep root help for the names, then prove each --help works) and is worth folding into the canonical."
---

# UX: skill and memory absent from root help (reconfirmed)

## Summary

Root --help does not list skill or memory though both exist as parent commands — reaffirm important-commands-absent-from-root-help.

## Evidence

```bash
$ poe-code --help | rg skill|memory → no matches
$ poe-code skill --help → works
$ poe-code memory --help → works
```

## Why it matters

Discoverability failure for major features.

## Suggested direction

Add skill and memory to root help command list.

## Severity

**High**

## Area

Help / discoverability
