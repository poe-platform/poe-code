# Completion leaf positional operands

## Scope and contract

Change only `src/cli/commands/completion.ts`,
`src/cli/commands/completion-command.test.ts`, and this new plan. Do not edit the
prior terminator plan. No dependencies, README changes, comments, commits, or
pushes. Preserve alias, inherited-option, required-value, and terminator fixes.

Only commands with `command.commands.length === 0` and at least one declared
`registeredArguments` entry retain their resolved completion path across operand
words. Count hidden children when deciding whether a command is a true leaf.
Derive this metadata from Commander, never hardcode command names.

Handle required option values and completed standalone `--` before retaining a
leaf operand. Flags remain available before/after positional operands until
termination. After `--`, keep operands literal and offer no Poe options, including
spawn's forwarded arguments. A pending required value of `--` is not a terminator.

Unknown paths and no-positional leaves must not retain their key. Positional
nonleaves such as `maestro WORKFLOW.md` remain a separately deferred case. This
change does not add operand arity validation, file/value suggestions, or optional/
variadic option-value parsing; declared variadic positional leaves are eligible.
Fish rendering remains unchanged.

## Baseline and sequence

The baseline commit is `4ac89fff07360d6151b1fa72e308329e46c6d0ca`, containing the
reviewed terminator fix. The parent's current before scripts are
`/tmp/poe-code-completion-terminator-after.bash` and
`/tmp/poe-code-completion-terminator-after.zsh`. Older
`/tmp/poe-code-completion-positional-before.bash` and its zsh counterpart predate
the terminator fix and are not the comparison baseline for this change.

1. Add memfs-backed real-tree metadata/candidate regressions for plan view,
   harness run, spawn and their aliases, including single/multiple/spaced/empty/
   command-looking operands, required values before/after operands, and sentinels.
2. Add fixture controls for all nested aliases, hidden-child parents, optionless
   positional leaves, unknown paths, no-positionals, and positional nonleaves.
   Pin retention after flag/value/terminator handling and before path extension.
3. Run focused tests red, then derive positional-leaf metadata and emit exact
   resolved-path retention cases in the bash/zsh scanners.
4. Notify the parent immediately after focused green, before extended checks;
   then run scoped lint/types and record evidence.

Unit tests inspect generated metadata, candidate branches, and scanner structure
in memory; they do not execute shells, create fixture files, or call network/LLMs.
Parent owns actual shell QA, screenshots, full-suite runs, commits, and releases.
Fish checks inspect generated source only.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts --reporter=verbose`

- 44 failed, 179 passed (223 tests; 366 ms test execution).
- Failures cover missing real/fixture positional-leaf retention, metadata-only
  leaves, alias combinations, and the required scanner ordering around retention.
- Negative eligibility checks, existing candidate/terminator controls, and fish
  output controls remain passing.

### Implementation

Add `isPositionalLeaf`, derived from the raw child count and declared arguments,
to each collected node. Retain metadata-only positional leaves. Emit exact path
cases that continue the scan without extending the resolved key, after existing
required-value, option, and terminator handling. No new shell state variable or
command-specific branch is needed.

Unknown paths, no-positional leaves, and positional nonleaves still extend the
path normally. Hidden children prevent leaf eligibility. Existing options-ended
candidate selection continues to return no Poe options for terminal leaves after
`--`, including forwarded spawn operands.

### Green

- `node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts`:
  all 223 passed (205 ms test execution).
- Parent was notified immediately after focused green, before extended checks,
  that full-suite and actual shell QA could proceed.
- Real-tree metadata/candidate cases cover plan view, plans view, harness run,
  spawn, and s; one/multiple/spaced/empty/command-looking operands; required values
  before/after operands; required `--` values; and terminated forwarded arguments.
- All nine fixture alias paths retain eligible leaves. Hidden-child parents,
  unknown paths, no-positionals, and `maestro WORKFLOW.md` remain excluded.
- Existing pending-required-value, parent/child traversal, inherited-option, and
  sentinel checks pass. Adding leaf arguments leaves fish output byte-identical.
- `npm run lint:types`: passed.
- `node_modules/.bin/eslint src/cli/commands/completion.ts src/cli/commands/completion-command.test.ts`:
  passed.
- `node_modules/.bin/prettier --check docs/plans/bugfix-completion-leaf-positionals.md`:
  passed.
- Scoped `git diff --check`: passed.

No full suite, actual shell execution, or screenshots were run by this worker;
parent owns those validations. No prior plan, dependencies, README, or other files
were edited by this worker, and no comments, commits, or pushes were added.

## Parent review and QA

- Reviewed the metadata predicate and scanner placement. Only true leaves with declared positional arguments retain context; option parsing still precedes operand handling.
- Executed 42 before and 42 after cases in actual Bash and zsh. Covered real plan/harness/spawn paths, aliases, multiple/spaced/empty/command-looking operands, options before and after operands, pending values, required `--` values, forwarded arguments, unknown commands, and no-positional leaves.
- The before baseline already includes the separately committed terminator fix, so that existing behavior is held constant in this comparison. All terminator and parent-traversal controls stayed unchanged.
- Captured and inspected before/after terminal screenshots. Options now remain available after valid leaf operands; no Poe options appear after a completed terminator.
- Non-leaf positional commands such as `maestro WORKFLOW.md` remain a separate unresolved case. No dependencies, user configuration changes, or business-command execution were involved in QA.
