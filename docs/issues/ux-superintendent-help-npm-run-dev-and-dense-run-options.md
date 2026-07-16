---
severity: medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/utils/execution-context.ts:203 returns 'npm run dev --' only for mode=development (intentional); `npm run dev -- superintendent run --help` renders an aligned OPTIONS list (--agent/--runtime/--detach one per line), not a single-line dump."
comment: "Duplicate combining the identity leak with the dense options dump; split and retire - the identity half into ux-development-mode-usage-intentional-but-leaks.md, the options half into ux-superintendent-help-format-inconsistencies.md, which states it better."
---

# UX: superintendent help is npm run dev with dense run option dump

## Summary

superintendent --help and superintendent run --help use npm run dev Usage and toolcraft-style dense OPTIONS paragraphs (Critical #23 class concurrent).

## Evidence

Usage: npm run dev -- superintendent [command] [OPTIONS]
run options as long single-line dump with --agent/--runtime/--detach…

## Why it matters

Reconfirm identity + dense help UX on superintendent.

## Suggested direction

poe-code Usage; design-system options list; --yes documented.

## Severity

Medium

## Area

Help / identity
