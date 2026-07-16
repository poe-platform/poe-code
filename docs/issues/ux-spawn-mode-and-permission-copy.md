---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:99 '--mode <mode>' desc 'yolo | auto | edit | read (prompted; --yes uses yolo)' vs src/cli/commands/gaslight.ts:320-322 choices [read, edit, yolo, auto] default auto"
comment: "Duplicate of ux-permission-mode-sets-differ-across-commands.md, which has the full four-command evidence; retire into it. Its distinct observation is worth carrying: '--yes uses yolo' is buried inside the --mode description rather than stated as a safety default, which is how the Critical (ux-spawn-yes-defaults-mode-to-yolo.md) stays invisible."
---

# UX: Permission mode semantics under-explained

## Summary

Modes minimal definition; --yes uses yolo buried; order differs spawn vs gaslight.

## Evidence

spawn: yolo|auto|edit|read; gaslight default auto different order.

## Why it matters

Safety control opacity.

## Suggested direction

Shared glossary; align defaults.

## Severity

**High**

## Area

Safety copy
