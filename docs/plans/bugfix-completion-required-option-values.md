# Completion required single-value options

## Scope and contract

Only `src/cli/commands/completion.ts`,
`src/cli/commands/completion-command.test.ts`, and this plan may change. Preserve
the committed alias traversal, candidate lists, hidden candidate visibility, and
fish renderer. No dependencies, README changes, new comments, commits, or pushes.

For bash and zsh, derive value-taking flag metadata for each canonical/alias path
from its command and ancestors. Resolve each exact flag spelling nearest-command
first, before retaining only options with `required && !variadic`. Include long,
short, short-only, and hidden options in parsing metadata, not necessarily in
candidates. Unrelated command flags must not leak between paths.

A recognized separate-value flag consumes exactly the next completed word before
any option or command interpretation, even when the value is a command name or
starts with a dash. A pending required value produces no command candidates and
no value suggestions. Inline `--flag=value` and attached `-fvalue` forms do not
consume another word; booleans do not consume values.

## Deferred boundaries

Optional-value options, required or optional variadic options, and short-option
clusters are not parsed for value consumption. They must not enter the required
single-value metadata, even when shadowing an ancestor's required option. Their
separate operands can still be interpreted as command words by the existing
scanner; this change does not claim support for those forms. Fish option-value
handling and broader matching semantics remain unchanged.

## Sequence and validation ownership

1. Add in-memory generation/metadata/structure regressions for root
   `-g/--profile work`, parent `-k/--kind pipeline`, nested `-e/--editor vim`,
   canonical and mixed alias paths, exact spelling/arity overrides, hidden and
   short-only flags, pending values, and deferred/inline/attached controls.
2. Run the focused completion tests before changing production code.
3. Generate scoped metadata and add one pending-value state variable to each
   bash/zsh scanner; consume values before all other word handling.
4. Re-run focused completion tests and record exact red/green evidence.

Newton independently reproduced the actual CLI failure in bash/zsh: separate
`plan --kind pipeline` has no candidates, inline `plan --kind=pipeline` works,
and a `browse` value incorrectly selects the nested command. Parent-owned real
shell QA and screenshots validate runtime behavior; this worker runs no shells
inside unit tests, creates no fixture files, and makes no network/LLM calls.
Existing real-program setup remains memfs-backed. Parent owns release actions.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts --reporter=verbose`

- 54 failed, 42 passed (96 tests; 37 ms test execution).
- Failures cover absent scoped/global metadata, spelling/arity precedence,
  metadata-only leaves, value consumption ordering, and pending-value guards.
- Existing alias/candidate tests, hidden candidate controls, and the unchanged
  fish output control remained green.

### Implementation

Collect options nearest-command first in a map keyed by exact long/short spelling,
then filter required nonvariadic values. Include metadata-only leaves. Generate
exact quoted `path:flag` case arms; each arms a single pending-value variable and
continues scanning. The next iteration clears that state and skips the value
before checking options or extending the command path. A still-pending value
returns before candidate generation. Zsh uses indexed word access to retain empty
words just as bash does. Candidate generation and the fish renderer are unchanged.

### Green

- The same focused command passed all 96 tests (29 ms test execution).
- Coverage includes global flags at the root, parent, and nested paths; local
  flags across all three-by-three alias combinations; unrelated-command scope;
  per-spelling boolean/optional/variadic overrides; and nearest required-option
  restoration below an overriding boolean.
- Structural checks prove the generated scanner consumes a pending word before
  flag/path interpretation and returns before candidates while a value is
  pending. Exact case arms exclude inline/attached forms, booleans, optional and
  variadic options, and short clusters.
- Hidden/short-only metadata and metadata-only leaves pass, candidate controls
  remain unchanged, and fish output is byte-identical when hidden/short-only
  required flags are added.
- `npm run lint:types`: passed.
- `node_modules/.bin/eslint src/cli/commands/completion.ts src/cli/commands/completion-command.test.ts`:
  passed.
- `node_modules/.bin/prettier --check docs/plans/bugfix-completion-required-option-values.md`:
  passed.
- Scoped `git diff --check`: passed.

No broader test suite or shell runtime validation was run by this worker. Parent
retains actual bash/zsh QA, screenshots, and release ownership. Fish results are
generated-source checks only, not runtime validation.

## Parent shell validation

- Executed 31 required-option, alias, scope, and control cases through production
  generated scripts in both Bash and zsh. All 62 checks passed, including hidden
  and short-only flags, inherited globals, boolean overrides, unrelated command
  scopes, command-looking and dash-prefixed values, quoted values, and pending
  values. Scripts and fixtures stayed in memory and shell stdin.
- Real interactive Bash TAB checks also passed for separate and inline values,
  the `plans` alias with a command-looking value, and nested list output options.
  No application command was executed and no shell configuration was changed.
- Visually inspected the before and after terminal captures. The separate-value
  path previously had no suggestions; afterward it matches canonical and inline
  forms. Artifacts remain ignored under `screenshots/`.
- Fish remains source-only validation. Optional/variadic arguments, short
  clusters, and value suggestions remain outside this fix.
