---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/program.ts:81-100 ROOT_HELP_COMMAND_SPECS lists gaslight and plan but omits skill and memory, though both are registered and unhidden (src/cli/commands/skill.ts:71, src/cli/commands/memory.ts:172)"
comment: "Narrow duplicate within the root help discoverability cluster (skill and memory only); retire into the canonical. Its framing is the sharpest small version of the argument: root help lists plan and gaslight while omitting skill and memory, so the curation is not obviously principled - a reader cannot infer why one made the cut."
---

# UX: root help still lists plan/gaslight but not skill/memory (reconfirmed)

## Summary

Root help includes plan and gaslight but skill and memory remain absent — reconfirm discoverability gap.

## Evidence

root help has plan, gaslight; no skill, memory lines.

## Why it matters

Reconfirm important commands hidden.

## Suggested direction

Add skill and memory to root help.

## Severity

**High**

## Area

Help / discoverability
