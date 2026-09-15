# Docx public-consumer typecheck build closure

Task: `public-consumer-and-shell-qa` in
[the ordered pipeline](docx-typescript-safe-bash.md). Execution date: 2026-09-15.
This correction addresses a maintained check failure encountered during that task.
It does not authorize subsequent tasks, a push or a release.

## Validated finding

`npm run typecheck:all --workspace=virtual-bash` regenerated declarations with raw
TypeScript compilation, bypassing the production builder. Relocated consumers then
failed with TS2307 for `@poe-platform/op` in `dist/commands/op/index.d.ts`.
The initial failure is recorded in `/tmp/docx-shell-types-20260915.txt`.

The maintained `scripts/build.mjs` already rewrites those declaration imports to
`dist/internal/op` and emits the required declaration closure. Provisioning an
additional dependency only in the consumer harness would conceal the difference
between alternate emission and the maintained package build.

## Owned correction

- `packages/safe-bash/scripts/typecheck-inputs.mjs`: retain output-directory
  admission, then request the maintained production builder for the build phase.
- `packages/safe-bash/scripts/typecheck.mjs`: execute that phase as a Node script;
  retain ordinary TypeScript and historical-model compiler dispatch for all other
  phases, existing uncached execution, failure handling and candidate receipts.
- `packages/safe-bash/scripts/integration-inputs.test.mjs`: strengthen the existing
  injected-filesystem regression to require the production builder after output
  admission, retaining rejection before compilation and build-failure assertions.

The unit regression mutates no host files. No consumer dependency provisioning,
public product behavior, inventory exclusions or build guards were changed.

## Failing test before code

The regression was changed before either implementation file.
`npm run test:runner --workspace=virtual-bash` exited 1 with 522 tests: 521 passed
and the strengthened build-route regression failed because it received
`["-p", "tsconfig.build.json"]` instead of `["/package/scripts/build.mjs"]`.
Evidence: `/tmp/docx-typecheck-builder-red-20260915.txt`.

After the correction, the same maintained command exited 0: 522 passed, zero
failed, skipped or cancelled. Evidence:
`/tmp/docx-typecheck-builder-green-20260915.txt`.
Both changed implementation modules also passed `node --check`.

## Actual maintained verification

After normal root build settled, the corrected
`npm run typecheck:all --workspace=virtual-bash` exited 0. It built once through
the guarded production route, passed source/test and historical compiler phases,
the three source consumer groups and all 26 relocated current consumer groups;
the expected negative consumers failed with status 2. Four held evidence inputs
remained authenticated and temporary outputs were cleaned. Evidence:
`/tmp/docx-shell-types-green-20260915.txt`. Its explicit result is
`typecheck-passed-not-runtime-acceptance`, with zero runtime executions.

Final root-suffix browser and packed runtime verification is recorded separately
in [the task execution plan](docx-public-consumer-shell-qa.md). Runner and typecheck
success alone do not establish browser, workerd or packed runtime acceptance.

No files were staged or committed by the bounded review worker.
