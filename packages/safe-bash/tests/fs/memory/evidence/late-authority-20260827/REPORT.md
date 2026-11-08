# Memory late explicit authority correction

This narrow followup supersedes the late-authority behavior of scoped checkpoint
`307938f`; it does not replace its immutable evidence or close the original remote
positive gate. Only Memory production source and owned tests/evidence changed.
No shared helper API, S3, WebDAV, core, or contract changes are included.

## Exact baseline and correction

The unchanged independent testcase `memory post-construction explicit comparison
error is not hidden by cached authority` reproduced **0/1** on Memory source
SHA256 `d1b0a082ece95555f740419b276d5565757fe3c3c3ba1555b927e9640dbcc62d`.
The private registered callback ignored a later public `compareEntry` replacement
that throws EACCES. Comparison returned distinct with zero callback queries; copy
also queried it zero times and overwrote the independent target with source bytes.
Source bytes survived; the actual bug was denial bypass and target mutation.

`before-source.ts.txt`, `before-independent.tap`, and `before.json` preserve exact
old source, raw observation, HEAD and source/fixture hashes. The independent file
was not edited; its exact bytes are retained in `independent-fixture.ts.txt`.

Memory's existing shared terminal callback now checks current public comparison
methods against the original method. For default-enrolled Memory operands only,
it invokes a changed explicit method once per operand before closed-store proof.
Missing/unknown explicit support stays unknown. Invalid or conflicting answers
fail EIO; real errors and caller cancellation propagate before content effects.
No recursive negotiation or extra metadata query is added. Complete known tuples
still win before the callback, as required by the unchanged shared contract.

The private enrollment set prevents duplicate queries: a preconstruction explicit
override, which is not registered with the default callback, remains exclusively
on the helper's external fallback path. The callback also handles both operands
when they share Memory's registered authority. It does not query unrelated remote
callbacks; their owners retain that responsibility.

After the fix, the same independent testcase passes **1/1**: both comparison and
copy throw EACCES, each invokes the explicit callback exactly once, and source and
target bytes remain unchanged. `after-independent.tap` retains the raw result.

## Bounded validation

- New owned late-authority tests: **17/17** (`author17.tap`).
- Existing focused 118 plus the new 17: **135/135** (`focused135.tap`).
- Exact unchanged independent Memory holdout: **1/1** (`after-independent.tap`).
- Strict five-backend scoped noEmit: **exit 0**, no diagnostics (`after.json`).

The new tests exercise late same/distinct/unknown/error/invalid/cancellation in
both source and destination positions, exact bytes/namespace on rejection,
metadata-only comparison, known-ID precedence, conflicting operand answers,
cancellation between callbacks, unregistered preconstruction peers, and bounded
forwarding of the base method. A proven distinct result still permits copy;
same/unknown/error outcomes do not become successful overwrites.

`after.json` records current HEAD, filesystem/contract/core source hashes,
fixture hashes, and results. The independent file hash is identical before and
after. The original **31/38 required positives** remain open at the historical
307938f checkpoint; that broad cohort was deliberately not rerun here, and none
of its fixtures or expectations changed. The independent historical 77/79
Memory/S3 aggregate is not relabeled by this Memory-only 1/1 replay. S3's parallel
late-authority correction remains separately owned.

## Reproduce

```sh
node --unhandled-rejections=strict --import tsx --test --test-name-pattern='^memory post-construction explicit comparison error' tests/fs/mount/identity-authority-review/implementation/adapter-binding.test.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/memory/late-authority.test.ts tests/fs/memory/comparison.test.ts tests/fs/mount/comparison.test.ts tests/fs/mount/identity-scope.test.ts tests/fs/mount/copy-identity.test.ts tests/fs/mount/copy-identity-guards.test.ts tests/fs/overlay/copy-identity.test.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/fs/{memory,real,mount,readonly,overlay}/*.ts tests/fs/{memory,real,mount,readonly,overlay}/*.ts
```

Raw TAP is preserved verbatim, including diagnostic whitespace. No full old
backend cohort, unrelated full-repository suite, or new metadata feature was
included in this followup.
