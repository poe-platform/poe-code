# Completion parent positional operands

## Scope and contract

Change only `src/cli/commands/completion.ts`,
`src/cli/commands/completion-command.test.ts`, and this new plan. No dependencies,
README changes, new comments, commits, or pushes. Preserve existing leaf,
no-argument, unknown-path, required-value, inherited-option, and terminator rules.
Do not expand optional/variadic option-value parsing or change fish rendering.

A command with declared positional arguments and registered children can dispatch
a child only at its first operand. Recognize every registered child name/alias,
including hidden children, but suggest only visible children. If that first
operand is not a child, retain the parent key and enter parent-operand mode.
Subsequent operands, even child-looking words, stay parent arguments. Continue
option/required-value scanning but suggest only parent/inherited options. Ended
options plus parent operands produce no candidates.

Pending required values take precedence over operand/child/terminator decisions:
`--config run` consumes `run` as a value; `--config other.md run` can still dispatch
`run`. A required value of `--` is not a terminator. Before a parent operand,
`maestro -- r` still suggests `run`. Hidden-child dispatch becomes unresolved in
the visible completion tree, never incorrectly reclassified as parent arguments.

## Baseline and sequence

Baseline commit: `9fdf6658d809e721caf0f801e6cef539c4386f37`. Parent already captured
actual generated scripts at `/tmp/poe-code-completion-parent-before.bash` and
`/tmp/poe-code-completion-parent-before.zsh`, plus its report and screenshot.

1. Add memfs-backed real-tree candidate/state cases for maestro, gaslight,
   experiment journal, required values before/after operands, child-looking
   values/operands, and terminators. Journal has a registered `log` child: after
   its doc operand, retain journal/global options but stop suggesting `log`.
   Before that operand, preserve dispatch to the positional leaf `journal log`.
2. Add fixture coverage for parent aliases, all registered child aliases including
   hidden children, metadata-only parents, no-argument groups, and unknown paths.
   Pin scanner order so required values and flags precede operand retention.
3. Run focused tests red, then derive parent dispatch metadata and add a separate
   parent-operand state without broadening `isPositionalLeaf`.
4. Notify the parent immediately on focused green, before extended checks; run
   scoped lint/types and document results.

Unit tests inspect generated metadata, scanner structure, and candidate branches
in memory. No shell spawning, fixture files, network, or LLM calls. Parent owns
actual shell QA, screenshots, full-suite runs, commits, and releases. Fish checks
are generated-source only.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts --reporter=verbose`

- Initial red: 159 failed, 115 passed (274 tests; 376 ms test execution).
- Failures cover missing parent dispatch metadata, operand mode, options-only
  branches, scanner order, and candidate expectations updated for the additional
  state key. Unaffected controls remain passing.
- Parent review corrected the initial journal classification: `journalCommand`
  registers a `log` child. Before final green, the matrix was corrected to treat
  journal as a parent and expanded with post-operand `log` suppression and normal
  dispatch to the positional leaf `journal log`.

### Implementation

Collect all registered child names/aliases for commands with declared arguments,
including hidden children. Keep `isPositionalLeaf` unchanged. Exact child matches
precede the first-nonchild operand case, which retains the key and activates a
separate `parent_operands` state. Existing flag/value/terminator handling runs
before that state's operand-retention guard; later child-looking words never
resume child dispatch.

Candidate selection distinguishes normal traversal, terminated traversal, and
parent-operand mode. Parent operands permit only resolved visible options until
termination; terminated parent operands yield no candidates. Hidden-child matches
extend into unresolved paths instead of becoming parent operands. No command
names are hardcoded in production.

### Green

- `node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts`:
  final matrix: all 278 passed (287 ms test execution).
- Parent was notified immediately after this corrected green run, before extended
  checks, that full-suite and actual shell QA could proceed.
- Coverage includes maestro, gaslight, and the actual experiment journal parent;
  required values before/after operands, pending values and literal `--`; first
  child/alias dispatch versus later child-looking operands; hidden children;
  parent aliases; no-argument/unknown paths; and existing leaf/terminator controls.
- `npm run lint:types`: passed.
- `node_modules/.bin/eslint src/cli/commands/completion.ts src/cli/commands/completion-command.test.ts`:
  passed.
- `node_modules/.bin/prettier --check docs/plans/bugfix-completion-parent-positionals.md`:
  passed.
- Scoped `git diff --check`: passed.

### Parent actual-shell and visual QA

The parent reviewed the state machine and reported all 78 actual generated-script
checks passing: 29 real-tree paths plus 10 fixture cases in each of Bash and zsh.
The parent had already captured 14 before cases and reviewed their screenshot.

- Runtime coverage includes parent options-only completion after operands,
  required values before/after operands and while pending, literal required-value
  `--`, first-operand-only child dispatch, empty/spaced operands, unknown and
  no-argument controls, existing leaves, and hidden-child/alias dispatch.
- Experiment journal is a parent with a registered `log` child: its doc operand
  retains journal/global options without suggesting or dispatching a later `log`.
  Child dispatch before that operand remains available.
- After scripts: `/tmp/poe-code-completion-parent-after.bash` and
  `/tmp/poe-code-completion-parent-after.zsh`.
- Parent captured the after report and captured/inspected
  `screenshots/bin-cat-tmp-poe-code-completion-parent-after.txt.png`.
- Parent reported no additional code issues. These are parent-run shell/visual
  validations, separate from this worker's in-memory unit checks.

No full suite was run by this worker. Fish runtime and optional/variadic option
consumption remain outside scope; fish generated-output controls pass unchanged.
No dependencies, README changes, new comments, commits, or pushes were made by
this worker, and no prior plan was edited.
