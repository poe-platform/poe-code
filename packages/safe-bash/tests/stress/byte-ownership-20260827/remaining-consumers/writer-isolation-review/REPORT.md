# Independent bounded writer-isolation review

**Accepted for the frozen bounded controls**, not whole-product qualification.
Candidate: `5f7fe5d72f031db6cbacc76d9bfefcba2f58d03e`.
Frozen controls/baseline: `0c5e2dff39e834fb50048386507a49116b2306fd`.
Historical attribution/reproduction: `60ddeb07`.
Candidate raw evidence and cleanup: `819e4105`.

The historical gate stays **unqualified: 16,520 pass / 307 fail / 13 skip**.
No full gate, external-network test, product fix, source audit, superiority claim,
or 72-hour work claim is part of this review.

## Frozen controls and observed results

| Control | Evidence and result |
| --- | --- |
| 1. Isolated old writer | Fresh b494 archive; 2/2 pass while the exact historical Buffer artifact changes; failed bytes and full test manifests retained. |
| 2. Actual default canonical | Same production canonical file in a different clean candidate archive: 2/2 pass, no observations or persistence. |
| 3. Concurrent canonical | Two independent, overlapping Node processes in the same clean candidate archive: 2/2 each, not substitute fixtures. |
| 4. Tree/sentinel integrity | All 19,773 tracked test files and all 213 product source files unchanged; sealed subtree included. Two read-only existing-path sentinels unchanged. |
| 5. Isolation/cleanup | No default temp output; no watchdog fired. Captures use three unique exclusive directories. Explicit captures persist by design until exact verifier cleanup; all bytes retained before cleanup. |
| 6. Explicit actual binding | Two overlapping capture-driver executions each preserve 2/2 observations, actual source/test/vector hashes, raw TAP/status, and matching before/after manifests. |
| 7. Existing/sealed refusal | Existing capture and sealed directory arguments rejected; sealed-directory TMPDIR rejected. Existing contents and sentinel bytes unchanged. |
| 8. Symlink refusal | Symlink destination argument and symlink TMPDIR resolving into sealed repository rejected. Referent bytes unchanged. |
| 9. Real failure retention | Only an isolated source copy reintroduces `Buffer.slice()` aliasing. Default and capture each produce 1 pass / 1 fail, exit 1; vectors, historical artifacts, error results and read-only failure sentinel preserved. |
| 10. No automatic acceptance | Failed observations remain failed; actual modified-source binding differs from success. No replay acceptance API exists. Neither capture nor this review repins/rebaselines historical expectations. |

These are **10 frozen controls across baseline and candidate**, not ten additional
canonical tests. Candidate default executions give **6/6** test-case results;
successful capture executions give **4/4**; the two deliberate failure executions
each retain **1 pass / 1 fail**. Five refusal invocations exit 1 as required.
The baseline's 2/2 and ten preexisting cleanup-hook failures are separate cohorts.
All **31 canonical assertion lines** are byte-identical to the original file.

## Exact bindings and profiles

- Canonical test SHA256: `f073a596d3dba0cef2126d3eda3ae116651f87a6c95d709ea1e0dcacb08bb621`.
- Capture driver SHA256: `126dcd9852fe61ae717ab707be74a0b8715e0c675988d11c5a534953767d9c01`.
- Unchanged expected-vector SHA256: `3a4777de116cb58cb17a029402d7a5d6eae1691dda6244350b75b0d160091704`.
- Complete tracked-test inventory digest before/after:
  `f03f5ae2fbcc9878e66d8d286b7b1385312a210a9d712260595daf72ecc9f83f`.
- Both success-path sentinel SHA256 values before/after:
  `559dcb4f94847dcb09f7861f910960ed03caf6266c6e59a7b7c852430ab26286`;
  bytes are also retained as base64 in `candidate-result.json`.
- Complete actual source inventory: `execution/candidate-source-before.json`.
  Candidate source Git tree `f214264ae13d47e1369513a12ccd2d6cf944a6ef`
  equals initial `95440687` exactly. Historical b494 source tree is
  `2b42daec96c628d1fcdf7b221e0ddd788592f6dc`; the intervening differences are
  `src/commands/env-split.ts` and `src/commands/execution.ts`, not writer changes.
- Node v22.22.2, Darwin arm64; existing tsx is resolved through an explicit
  `node_modules` symlink in each archive. The tsx version and source/config hashes
  are recorded. No dependency installation or ambient network transport is used.
- `TMPDIR/TMP/TEMP` explicitly select a disjoint verifier-owned scratch directory.
  The public driver uses `os.tmpdir()`/`mkdtemp`; no destination API was invented.
  `TSX_DISABLE_CACHE=1` disables installed compiler disk caching so temp observations
  distinguish fixture writes from compiler cache. No tests or sources are excluded.
- The driver accepts **no output path/options**, so existing-path controls verify
  rejection through that actual API. Two additional unsafe-temp-root controls
  exercise its realpath-based containment rule. No adversarial concurrent host
  directory replacement or universal symlink-race guarantee is claimed.

`execution/SEAL.json` verifies all four author-ready file hashes against the exact
candidate, full per-file execution evidence hashes, actual harness hashes, unchanged
assertions, and actual time overlap for both concurrency cohorts. The invariant
freeze predates author edits. Later execution adaptation only matches the published
no-argument capture API and explicitly controls compiler caching; no invariant or
expected vector changed to turn a failure green.

## Attribution of all 99 historical guard failures

**0/99 are caused by this writer; 99/99 are proven preexisting pin mismatches**
for these exact saved rows. Every diagnostic was checked, not inferred from labels.
All 89 diagnostic rows pin `tests/shell-stress/differential.test.ts`; all ten
cleanup rows pin `src/shell/shell.ts`. Clean archived b494 already has the exact
logged actual hashes rather than expected hashes, before either artifact write.
Actual diagnostic guard preflight and the actual cleanup test file reproduce those
refusals before the writer. Neither guarded path overlaps either artifact write.

The **separate post-test immutability guard failure is caused by the writer**.
Its exact Buffer artifact SHA changes from
`de63affa918da53853a7f8bc9ad1d863802c46c524e74af6b48359826139bc17` to
`ba6e0313257d6cf9a5164eec03ab7b2e23a885b10cbc84f5078c4dace0ccb0fd`,
matching the saved gate snapshots. `ATTRIBUTION.md` and
`execution/attribution-99.json` contain exact paths, expected/actual hashes,
preflight results, and the causal scope. No claim extends to other failures.

## Preservation, cleanup, and limits

The initial tree contained foreign untracked work, but all tracked writer/artifact
bytes matched Git and the index was empty. Those foreign files were untouched.
Other owners later staged and committed work; only explicit owned paths were staged
and committed here. The old canonical writer was never run in shared source.

Original historical bytes remain unchanged in shared source and preserved `.data`
copies. The failed reproduction is retained as its exact affected-file snapshot
plus complete before/after manifest, not restored. After verifying these permanent
copies, `cleanup.mjs` removes only its exact new scratch archives, extraction trees,
sentinels, and captured temp directories. This prevents nested discovery without
adding any exclusion. The original gate's already-removed copy was never touched.

All successful children settle close with no timeout/signal; observations report
zero active uploads/transports, no watchdog and no remaining timeout resources.
The runner kills only its exact child if its 45-second bound expires; none did.
No external network, server, regex probe, or broad process kill occurred. Process
closure and cooperative fixture counters are bounded evidence, not a general OS
resource-leak certification. Capture output intentionally remains available to its
caller until explicitly removed; the driver is not a replay/acceptance tool.

The first setup attempt hit a 256-MiB archive stdout buffer before any extraction
or test. That failure remains recorded; switching to file-backed compressed archive
output fixed setup without changing source or expected behavior. No candidate
holdout failed. Scoped JavaScript syntax checks and `git diff --check` pass; no
broad source/typecheck/gate run was needed for this verifier-only evidence task.
