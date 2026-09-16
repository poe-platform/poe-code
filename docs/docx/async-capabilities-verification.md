# Async capability acceptance verification

Verified on 2026-09-15 against local base `cbe95c963` and the bounded correction
described below. Full task acceptance remains incomplete.

## Verified correction

`Image.from_blob` and `Image.from_file` previously replaced an explicit null
context with defaults, unlike `openDocumentStyleModel`. Removing that override
routes all three factories through the existing shared finite-data validator.
Omitted/undefined contexts still use deterministic defaults; explicit null
rejects with the neutral `InputTypeError` (`usage`) in a Promise. No additional
editor, factory alias, authority or CLI spelling was introduced.

The original memfs regression uses a small authored PNG, checks both image
entry points and the style entry point, and verifies unchanged input bytes.
After correcting an initial memfs fixture setup error, it failed before product
code: two image cases resolved unexpectedly, while the style case passed.
After the one-line correction, all three cases passed. The adjacent focused run
passed 89 tests across six files, including the 23 existing async capability
cases and actual SDK-backed style/image command cases.

## Inspected prior evidence

Retained `/tmp/docx-async-*-red.log` files were read for original admission,
context accessors, final commit locking, nested getters, staged cancellation,
source receiver and unrelated reservation-ledger defects. Their failure messages
match the corresponding retained original assertions. The final focused receipt
records 54 passes; the maintained candidate receipt records 182 files, 3,501
passes and four skips. Prior lint and selected workspace build logs also exist
and were inspected. These are prior execution receipts, not newly executed
passes or substitutes for whole-public-API coverage.

The upstream audit separately reports missing original reference-runtime raw
artifacts. Their historical hashes cannot be verified without their bytes. No
reference environment was installed or rerun during this verification.

New regression red receipt: `/tmp/docx-public-surface-context-red.log`, SHA-256
`09ff287674ba29670ae650452214e19a135e824b57fc4acbb7fe11c7b20d7414`.
Focused green receipt: `/tmp/docx-public-surface-context-green.log`, SHA-256
`4cf490e0e2342ff98a1f1ae584a5e7888ed60b60d0ffea3a6ea6be6ea59b0b9a`.
These logs are disposable invocation outputs; the original regression survives.

## Actual output inspection

After the selected maintained build, emitted public exports created an original
document, added a style, saved 3,411 bytes through an explicit memfs sink and
reopened those bytes. The style name `Verification dune` and explicit false bold
value survived. The opener returned a Promise; model style access was
synchronous. Both emitted image factories rejected null context asynchronously
as `InputTypeError`, code `usage`.

Emitted exports report `typeof Document === "undefined"`. Shared schema entries
exist for `images.list`, `tables.list`, `properties.set`, `text.replace`, `schema`
and `capabilities`. Schema presence is discovery evidence, not an execution pass
for each operation. Maintained command cases exercise the same domain types.
No CLI presentation changed, so this correction requires no new CLI screenshot.
An actual emitted command-engine style batch dry-run returned exit 0, empty
stderr and version 1 JSON with `operation: "batch"`, `ok: true`, `affected: 1`,
`dryRun: true`, two results and no errors. Its explicit memfs input bytes remained
unchanged; this exercises the existing SDK-backed typed operation route.
No document renderer, browser/workerd campaign, downloaded document, cloned
binary or implicit network was used or claimed passing. The optional maintained
schema route invokes `/usr/bin/xmllint --version` before checking its schema root;
that native version-only probe ran before setup failed. No document/schema
validation ran, and the route was not repeated or provisioned. This attempt does
not qualify the requested native-free acceptance boundary.

## Acceptance gaps

The current live graph consists of styles/formatting, images, enums and helpers.
Document, paragraph/run, table, section/header/footer, comment and general
package/part live owners remain absent. Their factories, save/load and binary
admission methods therefore cannot satisfy the requested uniform async public
surface. Metric-dependent model behavior and live comment context defaults are
also unqualified. Existing utilities do not establish those model obligations.

Parsed inventory accounting remains unchanged: 920 source API records (410
planned, 378 security-mapped, 124 language-mapped, eight documentation errors),
1,337 proposed API-map rows and twelve guides. All 1,609 source unit variants
and 650 expanded BDD cases retain historical unmapped dispositions; the target
crosswalk's 2,259 rows remain mapped-not-implemented. Separate bounded adaptation
evidence does not turn these counts into whole-API execution coverage.

Inherited members, underscore-prefixed public owners, collections, helpers,
enums and APIs without upstream tests remain visible obligations. No inventory
denominator or shared contract was weakened. This task cannot be marked fully
accepted despite passing maintained checks for the bounded implementation.

The owned [verification procedure](../plans/docx-async-capabilities-verification.md)
records ownership and the original failing-before-code reproduction.

## Maintained scoped checks

| Check                                                   | Actual result                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test --workspace=docx`                             | Final correction: exit 0, 183 files, 3,504 passes, four skips; 132.43 seconds. Skips remain separate, including legacy cross-format cases. |
| `npm run lint --workspace=docx`                         | Final correction: exit 0, ESLint and both source/test TypeScript phases passed; one existing warning, zero errors.                         |
| `npm run build:workspaces -- --workspace=docx`          | Exit 0 using maintained dependency declarations, including portable safe-fs build with zero native assets.                                 |
| `npm run test:schemas --workspace=docx`                 | Exit 1 in setup: `DOCX_SCHEMA_ROOT` unset; ten skipped, zero schema case passes. Native version-only probe described above.                |
| Scoped maintained Prettier and owned `git diff --check` | Passed for the original regression and owned Markdown; one-line product diff has no whitespace changes.                                    |

Raw final receipts remain `/tmp/docx-public-surface-verification-test-final.log`,
`docx-public-surface-verification-lint-final.log`,
`docx-public-surface-verification-build.log` and
`docx-public-surface-verification-schemas.log`. The earlier unit run overlapped
the correction and lacked the newly added test; its 3,501 passes are not counted
as final-correction verification. No broad repository or shell rebuild/test
campaign was required by this one-line format-package correction.
