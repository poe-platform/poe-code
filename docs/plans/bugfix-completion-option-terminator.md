# Completion option terminator

## Scope and contract

Change only `src/cli/commands/completion.ts`,
`src/cli/commands/completion-command.test.ts`, and this plan. No dependencies,
README edits, new comments, commits, or pushes. Fish and optional/variadic option
handling stay unchanged. Leaf operand retention is explicitly deferred to a
separate fix; do not change the existing command-path accumulation for operands.

In bash and zsh, a completed standalone `--` ends option interpretation across
descendants, but does not end command traversal. Consume an already-pending
required value first, so `--dir --` uses `--` as its value. A later completed `--`
then terminates options. Inline values such as `--dir=--` and the current word
prefix `--` are not standalone completed terminators.

After termination, do not recognize options, skip dash-prefixed words, or consume
option values. Those words are literal operands. Continue command-path traversal
and offer only visible children/aliases; terminal nodes have no candidates.
An unresolved path such as `-- --verbose mo` must not restart at root commands.

## Sequence and QA ownership

1. Add memfs-backed real-tree generated-case coverage for root/group traversal,
   aliases, suppressed local/global options, unresolved literal operands, current
   prefixes, required `--` values, second terminators, and inline values.
2. Pin scanner structure: pending value first, exact terminator detection only
   inside option interpretation, literal word accumulation outside that guard.
   Existing required-value and inherited-option controls remain active.
3. Run focused tests red before production changes, then add an options-ended
   state and candidate branches derived from existing child/option metadata.
4. Notify the parent immediately when focused tests are green, before lint/types
   or full pre-push work. Record evidence and boundaries here.

Newton independently verified Commander behavior on public-metadata clones with
stub actions. Parent owns actual shell execution, screenshots, and release work;
its before scripts are `/tmp/poe-code-completion-positional-before.bash` and
`/tmp/poe-code-completion-positional-before.zsh`, with screenshot reports already
capturing terminator leakage. No additional before capture is needed.

Unit tests inspect generated candidate branches and scanner structure, not shell
runtime. They do not spawn shells, create fixture files, or call network/LLMs.
Fish assertions concern generated source only.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts --reporter=verbose`

- 91 failed, 89 passed (180 tests; 213 ms test execution).
- Failures include missing state-specific candidate cases, root/group child
  branches, scanner ordering/guards, and existing normal candidate expectations
  updated to the state-keyed case format.
- Fish controls, hidden-option metadata, and unaffected required-value controls
  remain passing.

### Implementation

Add one `options_ended` state variable per bash/zsh scanner. Keep pending-value
consumption first; recognize exact completed `--` only while option parsing is
active. Guard required-value lookup and flag skipping with that state. Continue
the unchanged literal command-path accumulation outside the guard.

Generate normal and children-only candidate cases from the existing node metadata,
selected by `options_ended:path`. The terminated branch never includes options;
terminal and unresolved paths yield no candidates. Do not return unconditionally
on `--` or retain leaf paths across operands. Required-value metadata and the fish
renderer are unchanged.

### Green

- `node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts`:
  all 180 passed (147 ms test execution).
- Parent was notified immediately after focused green, before lint/types work,
  that full-suite and actual shell QA could proceed without an intentional-red
  phase.
- Real-tree generated branches cover `-- mo`, `plan/plans -- v`, suppressed
  root/local/global flags, unresolved dash-prefixed operands, terminal nodes,
  current `--` prefixes, required `--` values, second terminators, and inline
  `=--` values. Fixture branches preserve visible child aliases and hide commands.
- Structural checks retain pending-value-first ordering and literal handling after
  termination; existing inherited-option and required-value controls pass.
- `npm run lint:types`: passed.
- `node_modules/.bin/eslint src/cli/commands/completion.ts src/cli/commands/completion-command.test.ts`:
  passed.
- `node_modules/.bin/prettier --check docs/plans/bugfix-completion-option-terminator.md`:
  passed.
- Scoped `git diff --check`: passed.

No full suite, actual shell execution, or screenshots were run by this worker.
Those remain parent-owned. Leaf operand retention remains unfixed by design for
the separately requested next change. No dependencies, README edits, comments,
commits, or pushes were added.

## Parent review and QA

- Reviewed scanner ordering and the separate option-ended candidate branches. Required values take precedence over terminators; literal dash-prefixed operands are no longer skipped after termination.
- Executed the real generated Bash and zsh scripts: 26 cases passed, covering root/group traversal, aliases, suppression of option candidates, literal operands, required values equal to `--`, second terminators, inline values, and ordinary option-prefix controls.
- Captured and inspected before/after terminal screenshots of the actual candidate results. Valid command completion remains available while invalid option suggestions disappear.
- In an interactive `zsh -f` session, Tab completed `-- mo` to `models` and `plan -- v` to `view`, left `plan -- view --out` unchanged, and completed `harness run --dir -- --re` to `--resume`. Lines were cleared without executing commands; history and completion-dump writes were disabled.
- No dependencies or user configuration changes were introduced. Leaf positional handling remains a separate confirmed bug.
