# Realm lifetime full package gate

## Latest boxed-primitive candidate

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
