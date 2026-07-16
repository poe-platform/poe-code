---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- --help lists 19 commands with no skill line, while npm run dev -- skill --help works; command registered at src/cli/program.ts:883"
comment: "Duplicate within the root help discoverability cluster; retire into ux-root-help-hides-skill-memory-runtime-eval-and-more.md, which enumerates all thirteen hidden commands. Coverage only."
---

# UX: skill still hidden from root help (reconfirmed via skill surface probe)

## Summary

Skill group works when invoked but remains absent from root help command list — reconfirm discoverability.

## Evidence

skill --help works; root help has no skill line.

## Why it matters

Reconfirm skill/memory hidden from root.

## Suggested direction

Add skill (and memory) to root help.

## Severity

**High**

## Area

Help / discoverability
