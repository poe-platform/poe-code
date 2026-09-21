# Current independent database codec review

## Manual procedure

1. Read the root and Safe Bash instructions, preserve all existing edits, and
   inspect the current codec and command implementation before choosing cases.
2. Inspect released Gnumeric 1.12.61 `plugins/paradox/paradox.c` and
   `src/value.c` beneath `out/ssconvert-lifecycle/gnumeric-1.12.61`, then inspect
   GOFFICE 0.10.61 `goffice/math/go-math.c` beneath
   `out/ssconvert-statistics-oracle`. Account for mapped dependency behavior:
   `gnm_strto` uses `go_strtod`, which expressly rejects C99 hexadecimal input.
3. Execute original in-memory SDK workbooks through the shared engine. Inspect
   independently specified record bytes, including explicit false versus null,
   numeric prefix conversion, signed integer bytes, ASCII whitespace and NBSP.
   Use memfs for every unit file operation; do not spawn an oracle in tests.
4. Trigger cancellation from a truncation diagnostic during export, and verify
   the original destination bytes and complete virtual namespace. Independently
   construct an encrypted header and verify rejection without companion access.
5. Run the focused database cohort and maintained workspace lint. Root owns
   build closures, whole-package unit gates, command integration, screenshots
   and Git delivery. Record exact source hashes and every unavailable cell.

## Observed failures and repairs

The initial original-byte regression failed before editing the exporter:
`tRuE` became false, while the string `1` became true. Released
`value_get_as_bool` recognizes only case-insensitive `TRUE`/`FALSE` strings;
unrecognized strings become false because the plugin ignores its error flag.
Integer strings use decimal `atoi` prefixes, and floating strings use GOFFICE
numeric prefixes. The exporter now follows those separate paths. Date export
truncates to its integer value before testing the serial-60 adjustment.

A follow-up NBSP negative control failed: JavaScript `parseInt` recognized
leading NBSP, which native `atoi` in the captured C locale does not. A small
ASCII-whitespace scanner now gates the integer prefix. An ASCII vertical-tab,
tab and positive-sign control remains successful.

An early draft expected hexadecimal numeric strings to become six using libc
`strtod` behavior. Dependency-source inspection invalidated that assumption.
The test was corrected to encoded zero, failed against the interim generic
parser, then passed after using the root-owned `databaseNumeric` helper. The
earlier hexadecimal-six pass is withdrawn, not compatibility evidence.

## Verified checks

The fresh focused Vitest run passed 34 tests across `database.test.ts` (23),
`database-stress.test.ts` (8), and `database-current-review.test.ts` (3).
The three new tests verify ten string-coercion fields using literal expected
record bytes; cancellation from a warning preserves the original destination
and exact namespace; an independently constructed encrypted header returns
the exact unsupported-feature error with no warnings or virtual file effects.

The maintained `npm run lint --workspace=@poe-code/ssconvert` route passed
both before and after the final dependency-parser refinement, including ESLint
and both source and test TypeScript checks. Focused tests are fresh deterministic semantic checks;
they do not establish a completed whole-workspace gate or performance result.

Candidate source SHA-256 values for the independent final test run:

- `paradox.ts`: `11aabe334be2aba83d6de13d7dbca95c0a3cfdc9c1eced8863611d7fcb759b8e`
- `database-support.ts`: `58ae7383a6b32a70d11c33151a381f35f9a3f1125907b248ffeca9dd532df9a2`
- `database-current-review.test.ts`: `31c4d45abb5225286946ab4df3fa9b003b036a055c028f56455f2c8e22448382`

## Unverified and remaining limits

No new native optional-pxlib differential run occurred in this review. Root
reports that the Docker daemon is unavailable; historical optional-profile
results remain prior-run evidence. Source-derived checks are not native passes.

Integer overflow, GOFFICE fake-truncation near representable integer boundaries,
embedded NUL strings, all non-C locale cells, full malformed-field corpora,
large dimensions, companion corruption and all upstream codepage variants are
unverified by this new cohort. Existing documented unsupported fields and
unsafe-oracle partial-output mismatches remain limits. The encrypted-input case
is a successful rejection control, not encrypted-format support.

Realm/host isolation and checkpoint/replay execution are not newly qualified by
these three SDK cases; existing command repeated-execution evidence is separate.
This agent performed no release, publication, push, commit, export or README edit.
