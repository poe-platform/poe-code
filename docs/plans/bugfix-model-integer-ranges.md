# Integer model parameter ranges

## Scope and contract

Change only `src/cli/commands/models.ts`,
`src/cli/commands/models-command.test.ts`, and this plan. Preserve the committed
eligibility-before-limits and structured-default formatting fixes. Integer
parameter bounds must render like number bounds in the Values/Range column.
Keep enum precedence, nullish-bound handling, truncation, column widths, and
raw YAML unchanged. Do not broaden the model schema or add helpers or dependencies.

The independently confirmed bug concerns contract-valid public-command
fixtures, not the prevalence of these values in actual API responses.

## Sequence

1. Add public-command tests using memfs and injected HTTP, asserting exact
   terminal cells for `3..`, `..9`, `0..`, `..0`, `-5..`, `..-2`, `2..8`,
   `-4..6`, and `0..0` for both integer and number schemas.
2. Cover blank unbounded integer/number cells, enum precedence for both types,
   and unchanged numeric constraints in a raw-YAML round trip.
3. Confirm integer regressions fail while the controls pass.
4. Extend only the existing number type check to accept integer too.
5. Run focused models and related tests, type checking, scoped lint, and
   whitespace checks. Do not run the full suite alongside the parent's prepush.

No new helpers, dependencies, inline comments, README edits, commits, pushes,
or unrelated file edits. Tests do not create files or access network/LLMs.

## Visual QA

The parent captured and inspected
`screenshots/ux-model-integer-ranges-before.png`: the bounded integer cell and
integer maximum-zero cell are blank, while the number `0..10` control is
visible. The parent repeated the same public-command fixture and visually
inspected `screenshots/ux-model-integer-ranges-after.png`: the integer range is
now `0..10`, the integer maximum-zero range is `..0`, and the number control is
unchanged. Assertions verify all three row values and unchanged memfs contents.
No user files, credentials, network, or LLMs were accessed. Rendering uses the
existing terminal-png package and screenshots remain ignored; no persistent QA
script was added.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/models-command.test.ts -t 'integer parameter ranges' --reporter=verbose`

- All nine bounded integer cases failed against the unchanged formatter,
  showing blank Values/Range cells instead of their expected ranges.
- Fourteen controls passed: nine bounded number cases, both unbounded cases,
  both enum-precedence cases, and the raw-YAML numeric-constraint round trip.
- Twenty-three cases executed in 89 ms. Log:
  `/tmp/poe-model-integer-ranges-red.log`.

### Green

- The focused command above passed all 23 cases (76 ms test execution):
  `/tmp/poe-model-integer-ranges-green.log`.
- `node_modules/.bin/vitest run src/cli/commands/models-command.test.ts --reporter=verbose`:
  all 127 models tests passed (201 ms test execution), including the prior
  eligibility and structured-default regressions and existing truncation tests:
  `/tmp/poe-model-integer-ranges-models.log`.
- `node_modules/.bin/vitest run src/cli/commands/models-command.test.ts src/cli/program.test.ts src/cli/container.test.ts src/cli/commands/shared.test.ts src/cli/commands/help-guidance.test.ts src/cli/commands/runtime-help.test.ts packages/toolcraft-design/src/components/components.test.ts packages/toolcraft-design/src/internal/internal.test.ts --reporter=verbose`:
  all 301 tests across eight files passed (428 ms test execution):
  `/tmp/poe-model-integer-ranges-related.log`.
- `npm run lint:types`: passed; `/tmp/poe-model-integer-ranges-types.log`.
- `node_modules/.bin/eslint src/cli/commands/models.ts src/cli/commands/models-command.test.ts`:
  passed; `/tmp/poe-model-integer-ranges-lint.log` (empty on success).
- `git diff --check -- src/cli/commands/models.ts src/cli/commands/models-command.test.ts`
  and `git diff --no-index --check -- /dev/null docs/plans/bugfix-model-integer-ranges.md`:
  passed.

### Result

The only production change accepts `integer` alongside `number` in the existing
range condition. Enum precedence, nullish-bound handling, truncation, schemas,
raw serialization, terminal widths, and both earlier fixes remain unchanged.
Tests use the existing model contract, including its string-valued enums,
without broadening JSON Schema support or claiming actual API prevalence.

Only the three scoped files were edited. No helpers, dependencies, inline
comments, README changes, commits, or pushes were added. No full suite was run.
Parent visual QA is recorded above; release validation remains with the parent.
