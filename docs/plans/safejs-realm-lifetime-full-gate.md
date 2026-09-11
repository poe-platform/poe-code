# Realm lifetime full package gate

## Latest generator candidate

Runtime HEAD `52d8ad42b` includes generator result identity and realm fixes.
The maintained package unit route ran its locale-generation pretest hook and
finished with exit 1 after 615.13 seconds (session 1567, start 05:16:23).

- Tests: 24,368 passed, three failed, 37 skipped; 24,408 total.
- Files: 947 passed, two failed, one skipped; 950 total.
- Two failures remain the native Promise string/symbol import-policy cases.
- The third is retained-root-accounting.test.ts: an async-function evaluation
  exceeds the 500-unit data limit at 917. It reproduces in the isolated file,
  so it is not classified as a transient or environmental failure.

The discovered source/test inputs retain SHA-256
`c31f51cabe7178d2dbc7770911e0fd10410402bc04eb4c6101fae47956dac7d8`.
Three regression files were added after discovery and run separately, not as
part of this gate: globals/promise-any-descriptors.test.ts,
globals/error-prototype-lifetime.test.ts and globals/promise-result-realm.test.ts.
Excluding those exact paths reproduces the original hash after completion.
The gate also includes the existing uncommitted weak-collection work and
Promise policy tests; it is not an isolated committed-tree validation.

The accounting follow-up restricts stored generator result prototypes to
actual async-generator nodes. Internal async-function frames and synchronous
generators do not consume that metadata. The unchanged accounting file plus
generator realm/delegation regressions now pass all 33 tests, and TypeScript
passes. Broader generator/snapshot/accounting validation passes 1,955 tests
across 136 files in 78.63 seconds. Scoped ESLint, 23 maintained workspace
builds and four fresh-process import checks pass. The built SDK accounting
probe now peaks at 428 within its unchanged 500 limit. This follow-up is not
covered by the full-gate result above.

## Previous reflection, iterator and RegExp matcher candidate

Runtime HEAD `c1b8b4eda` includes the reflection, descriptor, JSON, grouping,
entry-pair, toArray, built-in iterator-result and RegExp matcher realm fixes.
Its maintained build passed 23 workspace builds and four fresh-process import
checks. The full unit command below ran the npm pretest:unit locale hook.
Vitest started at 04:44:29 and completed in 686.12 seconds, exit 1 (session
57306). Documentation-only audit commits landed while it ran.

- Tests: 24,317 passed, two failed, 37 skipped; 24,356 total.
- Files: 944 passed, one failed, one skipped; 946 total.
- Both failures remain in promise-import-properties.test.ts: omitted native
  Promise own string descriptors and omitted user-symbol properties.
- No other failures or timeouts were reported. This does not establish a
  permanent fix for the earlier timing failures.

The sorted source/test SHA-256 matched before, during and after the run:

`958f252f6325d13c3381d9be5042572b07c402b85857258f1f9d45569160fcad`

The working tree still includes uncommitted weak-collection work and Promise
policy tests; this is not an isolated committed-tree result or a green gate.
The fingerprint covers source/test paths and contents, not dependencies,
generated dist or toolchains. Helper and generator result-realm gaps and
synchronous yield-star forwarding were independently validated during this
run; see safejs-helper-generator-result-realms.md. No push or release occurred.

## Previous array, split and match candidate

Runtime HEAD ae5b505ab includes the copy-by-change, default species, split,
and match-result realm fixes. The maintained build passed 23 workspace builds
and four fresh-process import checks. The full unit command below ran its npm
pretest locale hook, started Vitest at 03:55:06 and completed in 731.75 seconds,
exit 1.

- Tests: 24,176 passed, two failed, 37 skipped; 24,215 total.
- Files: 936 passed, one failed, one skipped; 938 total.
- Only the two native Promise property-import assertions failed.
- The checkpoint and camera timeouts from the preceding gate did not recur.
  This run proves a pass for those tests, not a permanent timing fix.

The sorted source/test SHA-256 matched before, during and after the run:

`fa292a36ab8101c083a6971570276d9b79084e71fe0ba5e53ade39f00426065f`

Documentation-only audit commits landed while the source and tests remained
unchanged. Uncommitted weak-collection work and Promise policy tests remain
included, so this is a working-tree result rather than an isolated committed
candidate. Reflection, iterator, descriptor, JSON and grouping realm audits
identify independent next fixes. No push or release occurred.

## Previous boxed-primitive candidate

Runtime HEAD fa36d37f3 passed the maintained selected-workspace build (23
builds and four fresh-process import checks), then the same unit command below
ran to completion, exit 1. It started at 03:29:47 and took 753.59 seconds.
Documentation-only commits landed during the run. Uncommitted weak-collection
work and Promise policy tests remain part of the tested working tree.

- Tests: 24,115 passed, four failed, 37 skipped; 24,156 total.
- Files: 930 passed, three failed, one skipped; 934 total.
- The two native Promise property-import assertions still fail.
- external-checkpoint-validation.test.ts timed out at 5000 ms for the pending
  `co` workflow.
- float32-camera.test.ts timed out at 5000 ms for one inverse-coordinate batch.

The sorted source/test SHA-256 matched before, during and after the run:

`ed900725d48bea1a453ec6d1486829b0b6e455f876468d39c57c3c6e1e3ec815`

A subsequent unchanged-source focused run of both timeout files passed all
25 tests in 22.06 seconds. The `co` case took 1513 ms; camera batches took
1744–2684 ms. This demonstrates an isolated pass, not a fix for the full-suite
timeouts or proof of their cause. No timeout, fixture, assertion or budget was
changed. Both full-suite timeout failures remain unresolved. No push or release.

## Candidate and command

Runtime HEAD: `5b6d9f487` (function rest-parameter realm preservation).
Documentation-only commits landed while the gate ran; source and tests did
not change. The working tree includes unrelated/uncommitted weak-collection
work and the two Promise property policy tests. This is not an isolated
clean-commit candidate, and the result does not verify remote delivery.

The maintained selected-workspace build completed 23 builds and four fresh
process import checks. Then:

```sh
npm run test:unit --workspace=@poe-code/safe-js -- --reporter=dot
```

The npm pretest:unit locale generation hook ran. Vitest started at 03:05:46
and completed after 594.76 seconds, exit 1.

## Result

- Tests: 24,091 passed; two failed; 37 skipped; 24,130 total.
- Files: 930 passed; one failed; one skipped; 932 total.
- Both failures are in `src/interp/promise-import-properties.test.ts`:
  native Promise string descriptors are omitted, and user-symbol properties
  are omitted.
- No other failures were reported. The previous full gate's 29 non-policy
  failures no longer appear after their fixes and the accumulated realm work.

The SHA-256 over sorted paths and contents under packages/safe-js/src and
packages/safe-js/test matched before, during, and after the run:

`a47a868812f236eee721cb0ce9f4ec356d0853080951a1dbb80045493086da2c`

That fingerprint does not cover dependencies, generated dist, or toolchains.

## Remaining work

The Promise import policy must not blindly copy private host metadata; see
safejs-host-promise-import-policy.md. Separately validated boxing and
array-result realm gaps remain in their audit plans. Passing existing tests
does not prove JavaScript conformance. No release or push occurred.
