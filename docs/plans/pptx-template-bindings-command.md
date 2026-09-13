# Typed template command integration

## Ownership and scope

Root owns `command-template.ts`, `template-schema.ts`, `command-template.test.ts`
and only the binding-related wiring hunks in `command-engine.ts`, `index.ts` and
the safe-bash test inventory. Existing uncommitted changes remain outside this
commit. Domain, CLI acceptance and research workers own their separate files.
No README, pipeline, push or release work is authorized here.

## Contract

Use `template apply INPUT` with exactly one `--data-json` or `--data-file`.
The JSON source is a closed array of typed bindings. Each binding requires its
slide scope, one-based slide position, name, kind, cardinality and corresponding
literal payload. Reject duplicate JSON keys and structural invalidity before
reading the deck. The domain preflights all required names and targets before
mutating its isolated graph. Protect auxiliary input files during publication.
SDK and command invoke the same domain operation; no interpreter or host lookup.

## TDD evidence

Initial `npx vitest run packages/pptx/src/command-template.test.ts` failed three
positive tests: both source alternatives and schema discovery returned usage
status 2 because the operation did not exist. Six negative tests already passed
under generic unsupported-command rejection and require a green positive control.

## Verification procedure

1. Run focused command/domain tests with original in-memory fixtures.
2. Build the maintained selected pptx workspace closure, then execute the
   delegated safe-bash memfs command tests, including shell-script invocation.
3. Run maintained pptx tests and lint, plus the changed safe-bash test inventory
   checks. Record exact outcomes without broad coverage claims.
4. Capture actual help and result output through the maintained terminal
   screenshot tool, inspect the image, and retain only the procedure/evidence.
5. Review and commit explicitly owned files and hunks on main. Report local
   hashes separately; do not push or run release work.

## Integration evidence

- Final focused domain/command coverage: 12 original domain cases and 12 command
  cases; four additional actual Shell cases cover text, table/image data, VFS
  input, dry-run, failures and publication protection. The final selected build
  completed all three declared build dependencies; final CLI rerun passed 4/4.
- `npm run lint --workspace=pptx` passed against a temporary copy of the staged
  package, using unchanged repository lint configuration and test helpers.
- The staged safe-bash test inventory passed all 107 maintained cases. Its
  contents were supplied to Node as a module in the original scripts directory,
  preserving relative imports while avoiding any change to the working file.
- Actual `template apply --help` and data-file dry-run output were captured with
  `scripts/screenshot.ts` at `/tmp/pptx-template-bindings-help.png` and
  `/tmp/pptx-template-bindings-result.png`. Help is complete and readable.
- A whole current-workspace package run observed three sanitization failures in
  unowned, uncommitted tests (canonical part names and a fixture ZIP header
  expectation). The working registry also referenced an absent sanitization
  test. Those files and changes were preserved. A binding test written during
  that run initially exposed empty media-type validation; its fix and focused
  rerun passed before staging.
- Verification of the intended commit uses a temporary copy of the exact staged
  pptx package, unchanged maintained Vitest configuration, explicit existing
  shared test dependencies and the normal `npm run test --workspace=pptx` route.
  The initial copy omitted the safe-fs XML helper, causing two import failures;
  the helper was supplied without changing product or test sources before rerun.
  Final result: all 172 files and 4,302 tests passed in 97.16 seconds. No tests were
  excluded from that staged package. Staged package lint/typechecks passed, too.
- Shared engine/export/inventory files contain unrelated working changes.
  Only the recorded binding hunks are staged; the full working files must not be
  used as commit path arguments because that would include unowned edits.
