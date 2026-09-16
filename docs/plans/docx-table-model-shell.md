# Table model shell acceptance

Scope: `adapt-upstream-tables-bdd` only. Owned files are the new
`packages/safe-bash/tests/commands/docx/table-model.test.ts`, its explicit literal
registration assertion in `packages/safe-bash/scripts/integration-inputs.test.mjs`,
this plan and `docs/docx/table-model-shell-evidence-20260915/`. Root owns Git.
No product logic, README, fixture retirement, push or release changes.

## Original acceptance procedure

Use original admitted XML/ZIP bytes backed by memfs and an explicit virtual
filesystem. Execute a real virtual `.sh` file, command substitution, binary
pipeline/stdin and the public explicit DOCX command plugin. Reopen produced bytes
through the public SDK and inspect growth, row/column widths, fixed layout,
Unicode cell text, merge order, merged aliases and negative row slicing.
Assert dry-run output is empty and inputs stay byte-identical. Reject invalid
row bounds and partial-overlap merges before binary publication; preserve a
preexisting destination and input even when earlier batch operations mutate.
These are five original supplementary shell cases, not 870 adapted source passes.

The registration presence assertion failed before changing the maintained literal
inventory. No product defect was found by this bounded shell acceptance. An
initial test incorrectly parsed stderr as JSON; shared JSON envelopes are stdout,
and the test was corrected without changing product behavior.

## Maintained verification

```bash
node --import tsx --test packages/safe-bash/tests/commands/docx/table-model.test.ts
node --test packages/safe-bash/scripts/integration-inputs.test.mjs
npx prettier --check packages/safe-bash/tests/commands/docx/table-model.test.ts docs/plans/docx-table-model-shell.md
```

Root runs the relevant maintained workspace gates before committing. Renderer QA
is not run by these tests: page wrapping, repeated header pagination and glyph
layout require the separate explicit Markdown renderer procedure. No screenshot
unit tests are added; there is no help or visual product change in this subtask.
