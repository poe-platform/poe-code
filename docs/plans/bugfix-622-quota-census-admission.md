# #622: bounded per-census quota traversal

## Scope and verified issue

Private candidate, 2026-09-05. `gh issue view 622 --repo poe-platform/poe-code`
returned author exactly `kamilio`, state `OPEN`, and the issue body saved in
`evidence/issue.json`. Its suggested fix explicitly permits capping walk depth
and entries, forwarding `readdir.maxEntries`, and failing closed past the cap.
This candidate implements that alternative, not incremental caching. The body's
elapsed-time, provider-billing and large-input claims were not re-executed or
validated here.

Evidence root:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-622-census-candidate.hYo2cA`

No live repository/Git, build, full-gate, README or GitHub-post actions occurred.
All commands ran escalated with Node v22.22.0, the supplied private TMPDIR,
TSX_DISABLE_CACHE=1, NO_COLOR unset and child GIT_* environment variables cleared.
The #620 candidate and handoff remain frozen and byte-identical.

## Design

- Add `maxScanEntries?: number` (default 4096) and `maxScanDepth?: number`
  (default 64) to `FileSystemQuotaOptions`. Validate nonnegative safe integers
  at wrapper construction. Zero and Number.MAX_SAFE_INTEGER are supported;
  explicit invalid values, including null, fail with RangeError. Existing
  maxBytes validation, value and byte-error class stay unchanged.
- Each `usedBytes` call owns a fresh remaining-entry counter. Every returned
  name consumes it, including directories. The root has no returned-name charge.
  Listings share this counter; different censuses do not share it.
- Forward the current remaining allowance as `readdir.maxEntries` with the
  caller's signal. Check cancellation immediately after awaiting the reply;
  admit and reserve its full length before any per-entry work. Shrinking a
  returned reply does not refund names; extra iteration beyond the reservation
  is separately admitted so array growth cannot evade the counter either.
- Carry directory depth in the existing pending traversal. Root is 0; files
  within a listed directory do not cause another directory descent. Reject a
  child directory deeper than the cap before queuing/descending, even if empty.
- Use existing EFBIG listing admission for entries and EFBIG/readdir with the
  rejected child path for depth. Do not translate backend errors or falsey
  cancellation into quota refusal.
- Keep the complete byte/alias/comparison calculation and each mutation body
  unchanged. Preserve external mutation observations, the per-wrapper queue,
  non-append stream truncation before the first census, accepted earlier chunks,
  iterator cleanup, and lack of tenant-global locking.

Limits apply to a census rather than post-mutation namespace size: a census
exactly at its entry limit can admit a creation, and an empty census with limit
0 can admit one file. The next census then fails closed if too large. Delegated
removal/mkdir behavior is not replaced by a new generic mutation budget.

This meets the issue's explicitly permitted capped-traversal alternative.
It intentionally does not repair the cost of arbitrarily many allowed censuses,
adapter-internal work, path-string processing, provider calls inside one method,
or ignored-limit host allocations. It is not a linear-time algorithm, global
execution/heap limit, namespace-entry ceiling, atomic namespace snapshot or
global writer lock. Existing composed-namespace creation-accounting limitations
remain documented and unchanged.

## TDD and focused validation

All product tests use tiny in-memory inputs; existing RealFS tests use their
maintained memfs mocks, and remote tests use their existing mock transports.
No native, live-provider, large-tree, OOM, RSS or elapsed-performance probes ran.
New depth boundaries use at most three nested directories, not a 65-level tree.
Default depth 64 is the explicit initializer, not a claimed executed large-depth
boundary. The default entry allowance is observed on an empty listing; numeric
maxima are tested using one ordinary file rather than large generated inputs.

Before implementation:

- `red.log`: 34 new tests, 31 RED / 3 compatibility PASS. Saved original test
  bytes are `evidence/tests-red.ts`. Failures establish missing validation,
  absent forwarding, unrestricted wide/deep/ignored-limit scans, and missing
  scan refusals/stream cleanup. No production change preceded this RED run.
- `baseline-adjacent.log`: all 107 existing tests PASS across both quota files
  and all three directory-admission files.

After implementation:

- `green-first.log`: all 34 new tests PASS.
- `all-requested-first.log`: all 141 tests PASS (34 new + 107 existing).
- `all-requested-expanded.log`: all 146 tests PASS after five additional controls:
  maximum safe configuration values, mutable host replies, inherited signal
  forwarding, falsey stream cancellation, and source-return failure precedence.
- `batch-reservation-red.log`: one additional RED (39 unrelated tests deselected)
  demonstrates that shrinking a returned array during awaited metadata could
  undercharge the initial candidate's per-processed-entry counter. Original
  candidate bytes remain in `quota-before-batch-reservation.ts`.
- Reserve the complete admitted reply up front and separately charge iteration
  beyond that reservation. This preserves the returned-name contract even when
  a host mutates its array; it does not invent namespace snapshot coherence.
- `all-requested-final.log`: final 147/147 PASS (40 new + 107 existing), no skips.

Coverage includes remaining allowances 2 then 1 across root/child listings,
zero-allowance empty children, exact entry/depth boundaries, early rejection
before name/type getters or lstat, unchanged accepted stream bytes, producer
closure without consuming a later chunk, outside additions/removal followed by
fresh census, byte/alias admission, same-wrapper queuing, and independent writers.
All guarded mutation families have cap-before-mutation controls; non-append
stream truncation is explicitly tested as the preserved exception.

Runtime selector, from the private `work` directory:

```sh
node node_modules/vitest/vitest.mjs run
```

The private config selects only:

- `packages/safe-fs/tests/quota-scan-admission.test.ts` (new, 40 tests)
- `packages/safe-fs/tests/quota.test.ts`
- `packages/safe-fs/tests/quota-hardlinks.test.ts`
- `packages/safe-fs/tests/directory-admission.test.ts`
- `packages/safe-fs/tests/directory-admission-wrappers.test.ts`
- `packages/safe-fs/tests/directory-admission-remote.test.ts`

These are focused requested cohorts, not repository/workspace-wide gates.

## Typecheck evidence and explicit limit

TypeScript 5.9.3 uses byte-exact snapshot package/root configs, including strict,
noUncheckedIndexedAccess and exactOptionalPropertyTypes. `strict-check.mjs`
changes only explicit focused roots, noEmit, disabled incremental state and
the rootDir needed to include tests. All source/declaration inputs are asserted
to resolve within the private snapshot.

- `types-focused-green.log` and final `types-focused-final.log`: quota source and
  new canonical test import closures each have zero diagnostics.
- The extra initial strict check of every adjacent test found one TS2339 at
  `packages/safe-fs/tests/quota.test.ts:46:33`: prior assert narrowing intersects
  incompatible literal capability types, making `streamingWrite` access `never`.
- `types-adjacent-candidate.log` and `types-adjacent-baseline.log` retain that
  same diagnostic. The baseline compiler reads the exact original quota source
  through a file-specific compiler-host override; all other source/test bytes
  are the same snapshot. It does not provide a fake type model or suppress errors.
- `types-first.log` and `strict-check-initial.mjs` preserve the initial wider
  audit and tool version. Adjacent tests were not edited or excluded from runtime
  execution. No claim of an all-adjacent-tests strict GREEN is made.

The requested changed-file focused types are GREEN; the separate baseline
adjacent-test diagnostic remains for root coordination, not a silent waiver.

## Private dependencies and delivery files

The installed dependency closure was copied into private node_modules before
validation: 76 packages, 3412 files, 59,417,182 bytes. The snapshot includes
Vitest 4.1.11, TypeScript 5.9.3, tsx, memfs and their installed runtime dependencies.
No package install or build ran. `evidence/dependencies.json` authenticates files
and internal links; no dependency link resolves into the live checkout. Root
builds therefore cannot replace these validation dependencies.

Exactly four proposed write files:

1. `packages/safe-fs/src/fs/quota/index.ts`
2. `packages/safe-fs/src/contracts/filesystem-quota.md`
3. `packages/safe-fs/tests/quota-scan-admission.test.ts`
4. `docs/plans/bugfix-622-quota-census-admission.md`

Root owns registration of the new literal test path, integration, Git and all
full gates. No Memory backend source changes are included. #620's later quota
forwarding mask is not part of this snapshot; this patch must not replace or
undo it when root eventually combines the independently reviewed changes.

Baseline SHA-256:

- Quota implementation: `8564f7b3010a753ca3e6562a585de864907278198c7badd2985c0805ca9cbd82`
- Quota contract: `030f33632f644e8561b7af87927f8a77ae06eda23ae31cb62fe89ee85c770c6c`

The final patch, handoff manifest and private apply-check authenticate exact
candidate bytes and retained evidence. #620 patch SHA remains
`5e0a7b7ce1963f53e766bc63f7c3fa15cb5265c610ddf01d74442d071951425d`;
its handoff SHA remains
`53b8a8183207e56a0f52513b9685c60f70818334949f1f3873e42743271166c8`.

## Root integration validation (September 5, 2026)

Root authenticated the frozen patch and both existing baseline files. The only
preexisting quota implementation difference is #620's missing-target forwarding
mask; the integrated file is verified byte-for-byte against the quota candidate
plus that exact guard. All other candidate files initially match the handoff.

The 40 new tests first produce 35 failures and five passes before the quota
implementation changes. After integration, all 1,184 tests in the complete
SafeFS test directory pass across 51 files. The maintained `vitest.root.config.ts`
discovery includes the new literal path exactly once; its existing package glob
needs no additional registry or count change. The SafeFS source typecheck passes.

Evidence is retained in
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-622-delivery.2lXzrk/`.
These are local integration checks, not a completed full maintained gate, push,
or release. The separate #633 correction is still pending, and the denied
upstream merge has not been retried.
