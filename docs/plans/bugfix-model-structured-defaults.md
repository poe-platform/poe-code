# Structured model parameter defaults

## Scope and contract

Change only `src/cli/commands/models.ts`,
`src/cli/commands/models-command.test.ts`, and this plan. Preserve the committed
parameter-eligibility-before-limits fix. Valid JSON object and array defaults
must display compact JSON rather than JavaScript string coercion. Keep scalar
formatting, blank nullish/empty-string defaults, the 36-character formatter
limit, terminal column widths, schemas, and raw YAML unchanged.

The independently confirmed loss concerns values accepted by the model
contract, reproduced through public `createProgram` with memfs and injected
HTTP. This does not establish their prevalence in actual API responses.

## Sequence

1. Add exact terminal default-cell cases for short/empty/nested objects,
   populated/empty arrays, scalar controls, and blank defaults.
2. Add an exact Markdown cell assertion for a long object's existing
   36-character truncation and a structured raw-YAML round-trip control.
   Preserve the existing terminal ellipsis test.
3. Confirm regressions fail against the existing formatter.
4. Keep the nullish guard and truncation; use `JSON.stringify(value)` for
   objects and `String(value)` for other values.
5. Run focused models and related tests, type checking, scoped lint, and
   whitespace checks; record red/green evidence.

No new helpers, dependencies, schema/raw/width changes, inline comments,
README edits, commits, or pushes. Tests use public commands, memfs, injected
HTTP, and the existing output-format scope; no file, network, or LLM access.

## Visual QA

The parent captured and visually inspected
`screenshots/ux-model-defaults-before.png` and
`screenshots/ux-model-defaults-after.png` through public command creation with
the same memfs and injected-HTTP fixture. The object now displays
`{"mode":"x"}`, the array displays `["a","b"]`, and the empty array displays
`[]`; the `false` control remains unchanged. Assertions confirm each displayed
value, absence of JavaScript object coercion, and unchanged in-memory files.
No user files, credentials, network, or LLMs were accessed. Rendering uses the
existing terminal-png package; artifacts remain ignored under `screenshots/`.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/models-command.test.ts -t 'structured parameter defaults' --reporter=verbose`

- Six failures against the unchanged formatter: short, empty, and nested
  objects; populated and empty arrays; and exact long-object truncation.
- Eight passing controls: zero, false, true, unquoted strings, null,
  undefined, empty strings, and structured raw-YAML round trips.
- Fourteen cases executed in 108 ms. Log:
  `/tmp/poe-model-structured-defaults-red.log`.

### Green

- The focused command above passed all 14 cases (155 ms test execution):
  `/tmp/poe-model-structured-defaults-green.log`.
- `node_modules/.bin/vitest run src/cli/commands/models-command.test.ts --reporter=verbose`:
  all 104 models tests passed (557 ms test execution), including the prior
  eligibility regressions and the unchanged terminal ellipsis test:
  `/tmp/poe-model-structured-defaults-models.log`.
- `node_modules/.bin/vitest run src/cli/commands/models-command.test.ts src/cli/program.test.ts src/cli/container.test.ts src/cli/commands/shared.test.ts src/cli/commands/help-guidance.test.ts src/cli/commands/runtime-help.test.ts packages/toolcraft-design/src/components/components.test.ts packages/toolcraft-design/src/internal/internal.test.ts --reporter=verbose`:
  all 278 tests across eight files passed (956 ms test execution):
  `/tmp/poe-model-structured-defaults-related.log`.
- `npm run lint:types`: passed;
  `/tmp/poe-model-structured-defaults-types.log`.
- `node_modules/.bin/eslint src/cli/commands/models.ts src/cli/commands/models-command.test.ts`:
  passed; `/tmp/poe-model-structured-defaults-lint.log` (empty on success).
- `git diff --check -- src/cli/commands/models.ts src/cli/commands/models-command.test.ts`
  and `git diff --no-index --check -- /dev/null docs/plans/bugfix-model-structured-defaults.md`:
  passed.

### Result

Only the conversion inside `formatDefaultValue` changes: non-null objects and
arrays use compact JSON, while scalar values retain their string conversion.
The nullish guard, 36-character truncation, terminal widths, raw serialization,
and committed parameter eligibility fix are unchanged. The tests demonstrate
rendering behavior for contract-valid fixtures, not actual API prevalence.

Only the three scoped files were edited. No helpers, dependencies, inline
comments, README changes, commits, or pushes were added by the worker. Parent
visual QA is recorded above; release validation remains with the parent.
