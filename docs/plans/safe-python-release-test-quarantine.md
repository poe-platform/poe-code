# Temporary Safe Python release test quarantine

The release unit gate fails on Safe Python compatibility tests. The user authorized
temporarily disabling these tests to unblock delivery on September 14, 2026.

The current checkout passes `npm run build`. A full package test run reproduced
327 failures across 42 files, with 85,977 passing cases overall and 1,150
fully passing files.
Failures include public buffer integration, traceback instruction metadata, codec
callback recursion and state handling, and native descriptor compatibility.

`packages/safe-python/test-quarantine.json` lists the 42 failing files. Both the
package Vitest configuration and the root/shared configuration exclude that same
list. These are file exclusions: passing cases in those files are also temporarily
disabled. The test sources and assertions remain intact. Other tests, build,
lint, audit, and release checks remain enabled. Exclusions are not test passes.

## Restore coverage

1. Remove one filename from the quarantine list.
2. Run `npm run test:unit --workspace=@poe-code/safe-python -- <filename>` to
   reproduce and fix its failures with TDD.
3. Run the package suite and applicable lint checks before committing each fix.
4. Once the list is empty, remove the quarantine JSON and its imports/exclusion
   wiring from both Vitest configurations.

## Verify this temporary change

- Run the Safe Python package unit suite and confirm the remaining files pass.
- Run `npm test` to verify root and declared workspace tasks, including their
  maintained build dependencies and lifecycle hooks.
- Run repository lint because the root/shared test configuration changed.
- If pushed, verify remote `main` and monitor GitHub through release publication.

## Verification results

The quarantined package suite passes: 83,807 tests across 1,150 files. This retains
all previously passing files; the reduced case count includes passing cases
within the 42 excluded files.
