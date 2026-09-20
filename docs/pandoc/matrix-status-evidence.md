# Command error status correction

Original regression: `packages/pandoc/src/command-status.test.ts`, authored
before implementation. First execution: 4 cases, 1 pass, 3 failures. Invalid
UTF-8, input budget exhaustion and unavailable bundled serif font all returned
status 2, instead of 4, 7 and 3 respectively. Unknown options correctly returned 2.
Every case uses memfs and asserts empty stdout, a typed stderr diagnostic and
an unchanged existing destination. No executable oracle is used by these tests.

After the correction:

- `npm test --workspace=@poe-code/pandoc`: 38 files, 960 tests passed, 0 failed.
- `npm run lint --workspace=@poe-code/pandoc`: passed, including both typechecks.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: passed; maintained
  runner selected 5 builds from the declared dependency closure.

The old tests' status-2 assertions were updated only where their already asserted
error codes require another status. Existing `E_WARNINGS` keeps status 2;
the implementation's older `E_RESOURCE` has status 6. These older names remain
contract reconciliation items; this commit does not claim complete conformance.

Logs: `matrix-status-test.log` (intermediate compatibility failures),
`matrix-status-test-final.log`, `matrix-status-lint-final.log`,
`matrix-status-build.log`. Native JSON, EPUB and rendered PDF lanes are separate.
