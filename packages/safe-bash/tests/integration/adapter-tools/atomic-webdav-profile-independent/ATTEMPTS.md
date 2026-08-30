# Independent attempts and classifications

## independent-first — verifier module-closure mistake

Original stock and packed stock each measured 78/79 with the original WebDAV
empty-rmdir failure. Build, original strict types and packed stock strict types
passed. The independently written module allowlist then rejected
`source/dist/contracts/errors.js`. Configured and hidden cohorts were not run.

Inspection of the frozen `src/fs/webdav/resource-id.ts` shows its existing runtime
`FsError` import from `../../contracts/errors.js`. The original MockDav fixture's
preexisting bookkeeping import therefore has a two-file frozen-built closure,
not the single file mistakenly assumed by this verifier. Both actual modules
and hashes are retained in the packed-stock load log. This is not a fixture or
production bug, and no product/fixture assertion changed.

The correction permits exactly those two frozen-built bookkeeping modules and
checks their actual resolution parent edges: MockDav to resource-id, then
resource-id to errors. It does not permit arbitrary source modules. The raw
failure, verifier inputs, original archive, tarball, compiled consumer and cleanup
remain in `evidence/independent-first/`.

## independent-second — completed bounded gate

The corrected independent runner reproduced original stock 78/79, packed stock
78/79, configured 79/79, unchanged author controls 22/22 and new hidden controls
27/27. All ten bounded helper/configuration mutations caused actual assertion
failures in a complete 27-test run, not import/type failures, cancellations,
skips or TODOs. Restoring the emitted helper restored 27/27. No original command,
assertion, production source, author helper or MockDav source was edited.

No new fixture/product bug was observed. The stock WebDAV ENOTSUP is the existing
retained failure, not a new regression or waived positive. The mutant failures
are deliberately introduced test-copy defects, not failures of the author helper.
Both attempts retain raw inputs, output and cleanup. Only `independent-second`
has a passing gate. See `REPORT.md` for exact scope and denominator distinctions.
