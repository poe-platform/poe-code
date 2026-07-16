---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:105-111 defines --skill <ref> and --skills [refs] with descriptions that never mention each other; resolveSkillOptions at src/cli/commands/spawn.ts:622-629 concatenates both into one list, confirming they merge silently."
comment: "Thin but real: two flags whose relationship is undocumented is the same shape as maestro's --config/--workflow pair. Needs the actual help text pasted to judge whether they merge, override or differ in scope. If they genuinely merge, one flag plus an alias is cleaner than documenting both."
---

# UX: --skill and --skills underexplained

## Summary

Both merge; help silent.

## Evidence

spawn --help.

## Why it matters

Two ways same.

## Suggested direction

Document merge.

## Severity

Low–Medium

## Area

Spawn / skills
