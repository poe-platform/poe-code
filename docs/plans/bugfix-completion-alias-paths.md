# Completion alias paths

## Scope and contract

Changes are limited to `src/cli/commands/completion.ts`,
`src/cli/commands/completion-command.test.ts`, and this plan. Use existing code and
dependencies only. Preserve canonical paths, expand every alias at each command
level, and retain mixed canonical/alias paths. Hidden commands, their aliases,
and hidden options must remain absent.

Do not change renderers, option-value parsing, fish matching semantics, root help,
README files, or other workers' files. No new comments, dependencies, network or
LLM calls, commits, or pushes. Unit tests generate scripts in memory without
spawning shells or creating fixture files; real program setup uses memfs.

## Confirmation and sequence

Newton independently confirmed missing alias paths in generated Bash 3.2 and zsh
5.9 scripts, including an interactive zsh run. Fish is not installed; its missing
alias conditions were identified from source, not runtime execution.

1. Extend the fixture with three parent names (`plan`, `plans`, `p`) and three
   nested names (`open`, `view`, `show`). Test all nine combinations for both bash
   and zsh, each parent path, and generated fish alias conditions. Retain hidden
   command controls and cover hidden nested aliases and options for all shells.
2. Run only the focused completion tests and record failures before production
   changes.
3. Recurse through `[child.name(), ...child.aliases()]` at every level, preserving
   the canonical traversal and existing renderers.
4. Re-run only the focused completion tests and record the green result.

The parent owns actual-shell QA, screenshots, and the wider pre-push suite. Its
before captures are `/tmp/poe-code-completion-before.txt` and
`screenshots/bin-cat-tmp-poe-code-completion-before.txt.png`.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/completion-command.test.ts --reporter=verbose`

- 24 failed, 15 passed (39 tests; 31 ms test execution).
- Bash and zsh each failed for parent aliases `plans` and `p`, and for all eight
  noncanonical combinations in the three-by-three nested path matrix.
- Fish source assertions failed for parent aliases `plans` and `p`, and nested
  aliases `view` and `show`.
- Canonical parent and nested paths, hidden controls across all three shells,
  existing script registrations/descriptions, unsupported-shell rejection, and
  real-program registration remained green.

### Implementation

Only the recursive expansion in `collectNodes` changes: visit the canonical name
and every alias for each visible child. No renderer or filtering changes.

### Green

- The same focused command passed all 39 tests (14 ms test execution).
- All three parent paths and all nine nested combinations now pass for both
  bash and zsh; generated fish parent/nested alias conditions also pass.
- Hidden commands, hidden nested aliases, and hidden options remain absent from
  all three generated scripts. Existing command controls remain green.
- Only the focused completion test file was run; broader tests, shell execution,
  and screenshots remain with the parent.

Fish checks cover generated source only; no fish runtime validation is claimed.
No new dependencies, README edits, comments, commits, or pushes were made.

## Parent terminal validation

- Executed actual CLI-generated Bash completion for `plan` and `plans`. Before,
  the alias returned no suggestions; after, both return the same nonempty list.
  Visually inspected the before and after captures under `screenshots/`.
- Executed the production generator's nested three-by-three canonical/alias
  matrix in both `/bin/bash` and `/bin/zsh`; all nine paths complete the fixture's
  `--json` option in each shell. Scripts were passed through stdin, without
  installing packages, changing shell configuration, or creating fixture files.
- Fish remains generated-source validation only because it is not installed.
