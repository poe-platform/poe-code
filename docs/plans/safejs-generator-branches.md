---
title: SafeJS generator branch restoration
---

## Validated issue and fix

Low-level restoration repeated conditional tests and logical left operands before
the suspended yield. Native comparisons exposed a conditional branch switch that
failed restoration, and a logical condition incrementing twice instead of once.
Twelve of sixteen new synchronous/asynchronous cases failed before the fix.

The validated yield AST identity determines which conditional arm or logical right
operand is already active. Resume that subtree without reevaluating the completed
condition. Yields inside the condition itself retain ordinary evaluation.

## CLI QA

Run this Markdown/agent-script pair with `npm run screenshot-poe-code -- harness
run docs/plans/safejs-generator-branches.md`. Inspect the screenshot: the harness
must pass with no spawns and no warnings. Its two generator results must each be
`[1,4]`. Unit tests independently serialize, restore, advance, and reserialize each
generator against native JavaScript; the CLI check does not replace that evidence.

This pair grants no external capabilities and spawns no agents.

## Verification

All 16 new native-comparison cases pass across three save/restore/advance cycles.
The full maintained SafeJS package route passes 15,258 tests with 41 existing
skips (422 passing files and one skipped file). Focused ESLint and the package
type check pass. The selected workspace build passed. The actual CLI screenshot
was inspected and showed a passing harness with zero spawns and no warnings.
