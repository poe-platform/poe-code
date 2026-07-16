---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "No addHelpText in src/cli/commands/spawn.ts or configure.ts (only src/cli/commands/models.ts:299 has 'Examples:'); `npm run dev -- spawn --help` and `configure --help` both end at Options with no Examples block. Duplicate of ux-primary-commands-still-lack-examples.md."
comment: "Reconfirm duplicate within the missing-examples family; retire into ux-primary-commands-still-lack-examples.md. Rated High against that file's Medium for the same observation; normalise."
---

# UX: spawn and configure help still lack Examples (reconfirmed)

## Summary

spawn --help and configure --help still have no Examples section — reconfirm vs models best-in-class help.

## Evidence

spawn/configure help: no Examples block.

## Why it matters

Reconfirm primary commands need Examples.

## Suggested direction

Copy models Examples pattern.

## Severity

**High**

## Area

Help
