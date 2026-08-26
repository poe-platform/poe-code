# Root help terminal newline

## Scope and contract

Limit changes to `src/cli/program.ts`, `src/cli/program.test.ts`, and this plan.
Root `--help`, `help`, and no-argument output must end with exactly one LF so the
next shell prompt starts on its own line. Preserve the existing single LF for
`configure --help` and `help configure`, along with help wrapping, titles, colors,
and content. Do not append a newline globally.

The parent independently captured each root path as 4,950 bytes with no trailing
LF; both configure help paths already have one LF.

## Sequence

1. Capture raw stdout for all five entry paths in memfs-backed unit tests.
   Assert one terminal LF, no second LF, a separate next prompt, no interactive
   prompts, and successful help completion.
2. Confirm the three root cases fail while both subcommand controls pass.
3. Add a final empty string to the root help array before its newline join.
4. Run focused and related help tests, type lint, scoped ESLint, and diff checks.

No new comments, README edits, dependencies, network or LLM calls, or test fixture
files. Leave other workers' changes untouched. The parent handles before/after
screenshots of the actual source CLI and any later commit or push.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/program.test.ts -t 'terminal newline' --reporter=verbose`

- Three failures: `--help`, `help`, and no arguments lack the terminal LF.
- Two passing controls: `configure --help` and `help configure`.
- Five cases ran in 19 ms; assertions inspect untrimmed, unstripped stdout.

### Implementation

Add only a final empty string to the root help array. Its existing newline join
now emits one terminal LF; subcommand rendering and all existing styling remain
unchanged.

### Green

- Focused command above: all five paths passed (29 ms test execution).
- `node_modules/.bin/vitest run src/cli/program.test.ts src/cli/commands/help-guidance.test.ts src/cli/commands/runtime-help.test.ts --reporter=verbose`:
  75 tests passed across three files (182 ms test execution), including existing
  help titles, usage, section formatting, 80-column wrapping, and four unchanged
  subcommand snapshots.
- `npm run lint:types`: passed.
- `node_modules/.bin/eslint src/cli/program.ts src/cli/program.test.ts`: passed.
- `git diff --check -- src/cli/program.ts src/cli/program.test.ts`: passed.

### Parent visual validation

Captured actual source CLI output using
`node_modules/.bin/tsx --import ./scripts/register-template-loader.mjs src/index.ts --help`
before and after the fix. Rendered its final six lines followed by a synthetic
`next-prompt>` using the existing screenshot command.

- Before: the repository URL and next shell prompt share a line.
- After: the next shell prompt starts on a separate line with no extra blank line.
- Both screenshots were visually inspected; no snapshot test or dependency was
  added. The artifacts remain ignored under `screenshots/`.
- Parent validation of the changed help and plan-ordering test files passed all
  71 tests.
