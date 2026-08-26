# Launch empty quoted arguments

## Independently confirmed behavior

The public registered launch command drops empty quoted arguments from an
interactive command line because token presence is inferred from string length.
For example, `printf '%s' '' tail` reaches the mocked SDK without its empty
argument. An empty quoted executable can incorrectly promote the next token to
the executable. Explicit argv preserves empty arguments, but currently permits
an empty executable to reach the SDK.

## Scoped fix

- Modify only `src/cli/commands/launch.ts`, `launch-command.test.ts`, and this plan.
- Track token presence separately from content in the existing parser.
- Mark a token started on opening quotes or ordinary content; flush started
  tokens on spaces, tabs, and end of input, even when empty.
- Do not flush on closing quotes: adjacent segments remain a single argument.
- Reject an empty first command in shared `resolveStartSpec` using the existing
  `ValidationError("Command to run is required.")` before calling the SDK.
- Preserve existing quote errors and other parser behavior. Do not add escaping,
  expansion, shell operators, dependencies, or new parsing APIs.

## TDD and validation

- Exercise registered commands with existing prompt/SDK mocks and memfs.
- Confirm red for single/double empty arguments in middle/trailing positions,
  repeated and adjacent empty segments, and empty executables.
- Test interactive/explicit-argv parity, ordinary adjacent segments, quoted
  spaces, tab separators, and both unterminated quote controls.
- Confirm green, notify the parent, then run scoped lint and type checks.
- Do not start real processes, call networks, or mutate host files in test flows.
- Leave concurrent work, old manifest patches, and assets untouched.

## Parent visual QA

The parent captured and inspected `screenshots/ux-launch-empty-args-before.png`
with an explicit SDK-stub caption. The actual PTY fixture used a verified SDK
stub, unchanged memfs, and no process launch. The parent owns after-change PTY
validation, screenshots, and review using the same safe fixture.

## Validation results

- Red: 17 expected failures demonstrated dropped arguments and accepted/promoted
  empty executables; 44 controls passed before the production fix.
- Green: all 61 registered-command tests passed in 65 ms with the SDK mocked.
- Removed unnecessary escapes in two new test literals; scoped ESLint passes.
- Root `npm run lint:types` and scoped `git diff --check` passed.
- The parent was notified that tests and scoped lint were green before retrying
  its commit. Actual after-change PTY/screenshots/review remain with the parent.

## Parent Review And After-Change QA

- Reviewed token-presence tracking and the shared empty-executable guard. Empty
  arguments remain in place; adjacent quoted/unquoted segments still form one
  token, and no additional shell syntax or expansion was introduced.
- In an actual TTY, the registered command accepted `printf '%s' '' tail` and
  passed exactly `["%s", "", "tail"]` to the verified SDK stub. Entering `'' echo`
  rejected the empty executable instead of promoting echo. Explicit argv with an
  empty executable was rejected by the same validation path, with no extra SDK call.
- Captured and inspected `screenshots/ux-launch-empty-args-after.png` against the
  before image. The screenshot explicitly identifies the SDK stub; its validation
  summary is QA output, not a claim about bootstrap error styling. No managed
  process was launched, and the in-memory filesystem remained byte-for-byte unchanged.
- Parent reran launch, completion, and all interactive suites: all 685 tests
  across 14 files passed. No dependencies, user configuration, or unrelated
  source changes were involved in the fix.
