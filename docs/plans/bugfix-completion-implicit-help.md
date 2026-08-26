# Completion implicit help options

## Scope and contract

Change only `src/cli/commands/completion.ts`,
`src/cli/commands/completion-command.test.ts`, and this new plan. No dependencies,
README changes, new comments, commits, pushes, or edits to prior plans. Preserve
unrelated manifest/assets changes and existing completion state machines.

Keep the regular nearest-command-first ancestor option walk, including hidden
blockers and required-value metadata. After that walk, supplement the map only
with `command.createHelp().visibleOptions(command)` for the current command.
Insert a long/short spelling only when no regular entry already owns it. Do not
walk ancestors' implicit help options or replace resolved regular entries.

This adds default/custom visible help with its description, retains help-only
leaves, and respects disabled/hidden help, per-spelling collisions, and short-only
help. Continue suggesting long flags only. Inherited regular required values and
hidden nearest spellings must still win over colliding implicit help.

## Baseline and sequence

Baseline commit: `036a8fd45dc007aae57527eb33be2f9e1a2c7df7`. The parent captured
10 actual before cases, immutable scripts at
`/tmp/poe-code-completion-help-before.bash` and
`/tmp/poe-code-completion-help-before.zsh`, and inspected
`screenshots/bin-cat-tmp-poe-code-completion-help-before.txt.png`.

1. Update existing exact candidate expectations for legitimate `--help` additions.
   Add all-three-shell generated-source cases for real root/models/plan view/
   harness run/maestro/plans view, custom help/descriptions/aliases, help-only
   leaves, disabled forwarding wrappers, hidden help, short-only help, regular
   collisions, inherited required values, and hidden blockers.
2. Run focused tests red before changing production code.
3. Supplement only the current command's visible help options after the existing
   regular walk. Do not alter renderers or parser state machines.
4. Notify the parent immediately after focused green, before extended checks;
   run scoped lint/types and record results.

Tests generate scripts in memory using memfs for real program setup, with no
shell spawning, fixture files, network, or LLM calls. Parent owns actual Bash/zsh
QA, screenshots, full pre-push runs, commits, and release actions. Fish is not
installed: validate generated source only and do not install or claim runtime QA.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts --reporter=verbose`

- 70 failed, 268 passed (338 tests; 345 ms test execution).
- Failures cover missing default/custom help, help-only leaves, the regular-short
  collision leaving implicit long help, and existing candidate expectations
  updated for legitimate `--help` additions.
- Disabled/hidden/short-only help controls, existing regular collision behavior,
  and unaffected parser metadata remain passing.

### Implementation

Add a seven-line current-help supplement after the unchanged regular ancestor
walk. For each current visible option, insert its long/short spelling only if the
map does not already contain that spelling. Existing candidate visibility,
long-only filtering, descriptions, and required-value derivation then operate on
the supplemented map. No renderer or parser state machine changes are needed.

### Green

- `node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts`:
  all 338 passed (390 ms test execution).
- Parent was notified immediately after focused green, before extended checks,
  that full-suite and actual shell QA could proceed.
- All three generated shell sources cover real current help, custom help and
  descriptions, aliases, help-only leaves, disabled forwarding wrappers, hidden
  `addHelpOption`, and short-only help without inventing `--help`.
- Regular long/short collisions, inherited required `--assist`, hidden local and
  inherited blockers, and required-value metadata remain correct. Implicit help
  does not become a required value or leak from ancestors into disabled wrappers.
- Existing terminator, parent/leaf positional, inherited-option, and alias
  controls pass with only legitimate candidate expectation updates.
- `npm run lint:types`: passed.
- `node_modules/.bin/eslint src/cli/commands/completion.ts src/cli/commands/completion-command.test.ts`:
  passed.
- `node_modules/.bin/prettier --check docs/plans/bugfix-completion-implicit-help.md`:
  passed.
- Scoped `git diff --check`: passed.

No full suite, actual shell execution, or screenshots were run by this worker;
parent owns after-runtime and visual validation. Fish is not installed and no
installation or fish runtime validation was attempted. No dependencies, README
edits, new comments, prior-plan changes, commits, or pushes were made.

## Parent Review And QA

- Reviewed the seven-line metadata supplement: it adds only current-command
  visible help options after regular entries, preserving hidden blockers and
  inherited required-value precedence without changing shell state machines.
- Executed 78 actual Bash/zsh cases: 21 real-tree paths and 18 fixture cases per
  shell. Covered default help, aliases, parent/leaf operands, regular controls,
  disabled forwarding wrappers, custom/hidden/short-only help, local and
  inherited collisions, pending values, literal required values of `--`, and
  completed terminators. All passed.
- Inspected the custom-help description in generated Fish source, including an
  apostrophe. No Fish runtime or installation was used.
- Captured and inspected `screenshots/bin-cat-tmp-poe-code-completion-help-after.txt.png`
  against the ten-case before reproduction. Visible help is now offered;
  disabled wrappers and terminated/value-taking contexts remain excluded.
- Parent independently reran completion and all interactive suites: 608 tests
  across 13 files passed. QA used no business actions, user configuration, new
  dependencies, or persistent test scripts.
