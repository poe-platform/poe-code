---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:107 declares '--skills [refs]' (optional value); bare flag yields boolean, collectSkillsOption at spawn.ts:610-612 returns previous ?? [], resolveSkillOptions at spawn.ts:622-628 maps empty to undefined, so skills are dropped with no error/warning; existing test spawn-command.test.ts:1210 asserts 'omits skills for bare --skills flag'."
comment: "Consolidate with ux-skills-empty-string-silently-ignored.md - same flag, same silent no-op, one from an empty string and one from a missing value. Its hypothesis is worth testing: if --skills without a value parses as a boolean, the flag's declaration is wrong rather than its validation, which would be a smaller and more precise fix than the empty-flag rule."
---

# UX: --skills without value appears accepted as no-op

## Summary

spawn … --skills with no value still runs the agent successfully (boolean presence?) without error or warning that no skills were bridged.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --skills
# succeeds without skill bridge message
```

## Why it matters

Optional flag with missing value should error or warn; silent no-op confuses.

## Suggested direction

Require value for --skills; error if empty list when flag present.

## Severity

Medium

## Area

Spawn / skills
