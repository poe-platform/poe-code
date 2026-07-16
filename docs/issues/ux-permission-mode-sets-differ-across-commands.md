---
severity: high
impact: usability
comment: "Excellent systemic filing, correctly High: four commands offer the same --mode concept with different choice sets, different orders and different defaults, and gh run omits auto entirely - so scripts cannot port --mode and the safety default is inconsistent exactly where it matters. Evidence is concrete and complete. Keep as canonical for a shared mode enum; it pairs with ux-spawn-yes-defaults-mode-to-yolo.md (the dangerous default) and ux-spawn-mode-case-sensitive.md (the parsing half). One shared enum plus a documented defaults matrix closes all three."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:99 'yolo | auto | edit | read'; src/cli/commands/gaslight.ts:320-322 choices(['read','edit','yolo','auto']).default('auto'); src/cli/commands/harness.ts:87-88 '(read|edit|auto|yolo)'; packages/github-workflows/src/commands.ts:102 S.Enum(['yolo','edit','read']) with no auto"
---

# UX: Permission mode choice sets differ across spawn/gaslight/harness/gh

## Summary

spawn: yolo|auto|edit|read; gaslight: read|edit|yolo|auto with default auto; harness: read|edit|auto|yolo; github-workflows run: yolo|edit|read (no auto). Same concept, different sets and order.

## Evidence

spawn --mode yolo|auto|edit|read
gaslight default auto; choices reordered
harness read|edit|auto|yolo
gh run: yolo|edit|read (no auto)

## Why it matters

Scripts cannot port --mode between commands; safety defaults unclear.

## Suggested direction

Single shared mode enum + defaults matrix documented on every command.

## Severity

**High**

## Area

Safety copy
