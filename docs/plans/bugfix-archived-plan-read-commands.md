# Archived plan read commands

## Scope and contract

Limit changes to `src/cli/commands/plan.ts`, its existing adjacent command tests,
and this plan. Both `plan --archived list` and `plan list --archived` must list
archived plans only. Both flag placements for `plan view` must resolve archived
plans and reject active plans. Without the flag, list and view remain active-only.
Production list/view help must advertise the inherited `--archived` option.

Parent option inheritance and SDK archive-only discovery already work. The list
and view handlers omit the third `archived` argument when calling `discoverPlans`.
Forward `options.archived` at those two call sites; leave browsing, mutation
commands, option declarations, and SDK behavior unchanged.

## Sequence

1. Add memfs-backed public `createProgram` regressions for both flag placements,
   archive-only selection, active controls, and inherited help.
2. Run the focused cases before changing production code and confirm failures.
3. Forward the existing option in the two read-path discovery calls.
4. Run focused and adjacent plan tests, scoped ESLint, typecheck, and diff checks.

No new dependencies, inline comments, README edits, commits, pushes, or unrelated
changes. Test fixtures stay in memfs. The parent handles screenshots, release,
and integration validation.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/plan-command.test.ts -t 'archived plan read commands' --reporter=verbose`

- Six failures, covering both parent and post-subcommand flag placements:
  list returned the active plan, archived view rejected the archived path, and
  archived view incorrectly accepted the active path.
- Five passing controls: active-only list/view selection and rejection, plus
  inherited list/view help advertising `--archived` under Global Options.

### Implementation

Pass `options.archived` as the third argument in `renderPlanList` and the view
handler. These are the only two production-line changes. No duplicate local
options are necessary because the public command already parses both placements
and advertises the inherited option.

### Green

- Focused command above: all 11 regressions passed (42 ms test execution).
- `node_modules/.bin/vitest run src/cli/commands/plan-command.test.ts src/cli/commands/plan-root-command.test.ts src/cli/commands/plan-install.test.ts src/cli/commands/skill-plan-agent-messaging.test.ts`:
  all 79 tests passed across four files (219 ms test execution), including
  existing browse, archive, unarchive, edit, delete, dry-run, and confirmation
  coverage.
- `node_modules/.bin/eslint src/cli/commands/plan.ts src/cli/commands/plan-command.test.ts`:
  passed.
- `npm run lint:types`: passed.
- `git diff --check -- src/cli/commands/plan.ts src/cli/commands/plan-command.test.ts docs/plans/bugfix-archived-plan-read-commands.md`:
  passed.

## Parent visual validation

Ran the public command with an in-memory active/archive fixture, captured both
`plan --archived list --output terminal` and
`plan view docs/plans/archive/archived.md --archived --output terminal`, and
rendered them with the existing terminal-png package. Visually inspected
`screenshots/ux-archived-plan-read-after.png`: the table contains only the archived
plan and the view displays its body. Assertions also exclude the active plan.
No user files, network, credentials, or LLMs were accessed. The artifact remains
ignored under `screenshots/`; release validation remains with the parent.
