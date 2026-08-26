# Completion inherited option candidates

## Scope and contract

Change only `src/cli/commands/completion.ts`,
`src/cli/commands/completion-command.test.ts`, and this plan. Preserve committed
alias traversal and required-value parsing. No dependencies, README changes,
security work, optional/variadic parsing changes, new comments, commits, or pushes.

Derive visible long-option candidates from the existing nearest-command-first
`optionsByFlag` map, after exact-spelling deduplication. A hidden nearest long
spelling masks its ancestor; a visible nearest spelling can expose a hidden
ancestor. A short-only shadow must not suppress a separately inherited long
spelling. Keep the nearest description and each long candidate only once.
Optionless leaves inherit visible global options too.

## Baseline and sequence

The baseline before this worker's changes is commit
`7afd606c9d048c00876e24f96258f2f63f49115c`; the parent can use `git show` for
before/after QA without reverting the working tree.
The parent also captured original scripts and terminal output at
`/tmp/poe-code-completion-inherited-before.bash`,
`/tmp/poe-code-completion-inherited-before.zsh`, and
`/tmp/poe-code-completion-inherited-before.txt`, plus its before screenshot.

1. Update fixture expectations for inherited globals and parent options. Add
   memfs-backed real-program cases for `models --v/--y/--o`,
   `plan list --d/--y/--ar/--k/--o`, and `plans list --ar/--k`.
2. Add optionless-leaf and hidden/visible/short-only precedence controls, including
   nearest fish descriptions and duplicate suppression.
3. Run focused tests red before changing production code.
4. Move visible candidate derivation to the resolved map without changing
   `requiredValueFlags`, scanners, renderers, or alias traversal.
5. Notify the parent as soon as focused tests are green, then run scoped lint and
   type checks. Parent owns full pre-push runs, actual shell QA, screenshots,
   and release actions.

Tests generate scripts in memory; no shell spawning, fixture files, network calls,
or LLM calls. Fish checks inspect generated source only, not fish runtime behavior.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts --reporter=verbose`

- 56 failed, 79 passed (135 tests; 116 ms test execution).
- Missing inherited candidates fail in the real `models`, `plan list`, and
  `plans list` paths, nested alias fixture expectations, and optionless leaves.
- Precedence tests expose missing inherited long spellings and descriptions;
  hidden-mask controls and required-value parser regressions remain passing.

### Implementation

Replace local-only `command.options` candidate derivation with entries from
`optionsByFlag`, retaining entries whose key equals the option's long spelling
and whose resolved option is visible. Map the resolved spelling and description
into the existing candidate structure. `requiredValueFlags`, scanners, renderers,
and alias traversal are unchanged.

### Green

- `node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts`:
  all 135 passed (74 ms test execution).
- Parent was notified immediately after focused green, before lint/types work,
  that the full-suite pre-push and actual shell QA were safe to start.
- Real-program cases retain local `--view`/`--output` and exactly one `--kind`,
  while adding inherited `--verbose`, `--version`, `--dry-run`, `--yes`, and
  `--archived` where expected.
- All hidden/visible/short-only precedence cases, nearest descriptions, alias
  paths, optionless leaves, and existing required-value controls pass.
- `npm run lint:types`: passed.
- `node_modules/.bin/eslint src/cli/commands/completion.ts src/cli/commands/completion-command.test.ts`:
  passed.
- Scoped `git diff --check`: passed.
- `node_modules/.bin/prettier --check docs/plans/bugfix-completion-inherited-options.md`:
  passed.

No full suite, actual shell execution, or screenshots were run by this worker;
those remain parent-owned. Fish validation is generated-source only. No
dependencies, README edits, new comments, commits, or pushes were made.

## Parent review and QA

- Reviewed the minimal candidate-only change; value parsing and renderers remain unchanged.
- Executed generated scripts from the public memfs-backed command tree in Bash and zsh: 20 cases passed, covering global flags, parent flags, aliases, local controls, an optionless leaf, and required-value consumption.
- An initial QA case incorrectly used the synthetic fixture's `agent list` path against the real command tree. Replaced that case with the real optionless `completion` leaf and reran the entire matrix successfully; no production change was needed.
- Captured and inspected before/after screenshots of both shells' actual candidate results. The first attempted after capture followed the invalid fixture assertion; it was replaced by the successful full-matrix capture.
- In an interactive `zsh -f` session, Tab completed `models --verb` to `--verbose`, `plan list --d` to `--dry-run`, and `plans list --ar` to `--archived`. Each line was cleared without executing a business command. History saving and completion-dump writes were disabled.
- Fish coverage remains generated-source only. No dependencies or user configuration were changed.
