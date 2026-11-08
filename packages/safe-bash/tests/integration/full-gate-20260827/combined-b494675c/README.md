# Frozen b494675c diagnostic capture — 2026-08-27

## Verdict and candidate

**Not a qualified whole-product gate.** Frozen canonical discovery selected 550
files and completed **16,840 tests: 16,520 pass, 307 fail, 13 skip, zero TODO or
cancelled**. The accounting reconciles every TAP result with its footer. Do not
subtract subsequent focused passes or characterize all passing tests as supported
guest workflows: historical defect-characterization tests remain in this corpus.

Candidate `b494675c34dc289f4ad4b10a9201e1211eb0a7d8` is the genuine direct parent of
env-S production `84ab66ca717e0dff21abf57051b41cb553f3c7f3`, not a cherry-picked tree.
It contains required `c3fbda62`, `1ad428ed`, `7d7dce7c`, `3bf672f`, `b2821599`, and
SafeJS fixture revisions `656ee2b0`/`1602a5d2`. It already contains env-S author tests
but not that feature's production implementation. Their failures are retained.
This is not a claim about the later, concurrently changing shared HEAD.

Two infrastructure defects invalidate qualification:

1. This verifier staged metadata/archive/byte prerequisites but omitted native
   stream tools required by the broader suite. This caused 114 failures and some
   skips. They are verifier setup defects, not 114 product defects.
2. An unchanged canonical fixture overwrote a tracked historical artifact. The
   immutability guard stopped subsequent phases and removed the snapshot; the
   declared combined pipeline did not reach its contracts/benchmark/package phases.
   The independently run public checks below are separate cohorts, not resumed
   phases on that mutated tree.

An initial attempt stopped before tests when the historical inspector rejected
twelve committed native tree-fixture symlinks. The owned inspector now verifies
their literal Git blob/targets without following them, preserving cycles and
dangling links. The exact committed npm discovery wrapper is used; neither tests
nor historical links were omitted to obtain this capture.

## Every failure routed

`FAILURE_ROUTING.json` contains all 307 exact test names, paths, TAP lines, raw
diagnostics, classification, owner routing, and next action. `SKIPS.json` preserves
all thirteen skip reasons; unavailable external observations are not passes.

| Frozen failures | Classification | Route |
| ---: | --- | --- |
| 114 | `nl`, `seq`, `unexpand` binaries omitted from verifier staging | Curie / gate prerequisite harness |
| 89 | Historical shell diagnostic helper hash refuses the candidate before its bodies run | Sagan / diagnostic fixture owner |
| 10 | Invocation-cleanup public fixture pins an earlier shell source | Sagan / fixture owner |
| 84 | env-S tests precede env-S production in this genuine ancestor | Sagan / approved later feature candidate |
| 2 | Native Darwin setid/SGID permission profile mismatches | Metadata/RealFS owners, host-profile review |
| 1 | Search differential subprocess exceeded its 10-second limit | Gate concurrency/search fixture owner |
| 1 | Search cancellation does not satisfy the stalled-stdin closure assertion | Search/runtime owner |
| 5 | Known custom pre-first-read pipeline cancellation deadlines | Sagan / output-lifecycle review |
| 1 | Earlier S3 fixture expects unsupported rmdir, but snapshot-marker support now exists | FS fixture owner; preserve descendant safety |

No expectation, source, or canonical fixture was changed by this review. Hash
refusals require a justified fixture migration, not automatic repinning. The five
first-read failures are custom lifecycle requirements, not universal native Bash
semantics. The chmod cases do not justify unsafe command-level rollback.

## Focused diagnostics, not a revised full score

Fresh copies of the **same commit** give:

- Restored authenticated stream prerequisites: **122/122**, zero skip/TODO.
- Search differential alone: **486/486**, zero skip/TODO; the full-capture timeout
  did not recur in this lower-concurrency run. That does not prove absence of races.
- Search safety + remote-close + S3 workflows: **43 pass / 7 fail**, zero skips.
  Stalled stdin, all five first-read deadlines, and the S3 refusal assertion still
  fail. This supports routing them separately from the subprocess timeout.
- Direct-curl artifact writer: **2/2 assertions pass while overwriting history**.
  The original artifact SHA `de63affa918da53853a7f8bc9ad1d863802c46c524e74af6b48359826139bc17`
  becomes `ba6e0313257d6cf9a5164eec03ab7b2e23a885b10cbc84f5078c4dace0ccb0fd`.
  Before/after bytes are preserved in the evidence, not silently replaced.

The first focused run itself omitted `rg` from PATH: 39 pass / 11 fail, including
four extra top-level missing-oracle failures. It is preserved as `focused-v1`.
The corrected `focused-v2` stages the same authenticated ripgrep 15.2.0 binary as
the full capture; product source and fixture bytes remain unchanged. Never merge
the two focused denominators or subtract their passes from the full failure count.

### Required fixture-owner action

`tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/direct-curl.test.ts:45`
sets the output directory to its tracked `artifacts/`; line 213 writes results
unconditionally. The sibling manual runner's existing-output guard is not part of
canonical npm discovery. Repair output routing to a task-owned temporary/output
location while keeping fixture inputs and assertions, then independently verify
both cases and tracked-input immutability. This reviewer has not edited that scope.
No further expensive whole run is launched pending this repair/candidate decision.

## Types, public execution, and actual SafeJS

- Production build passes. Cold global TypeScript has **30 diagnostics**; a fresh
  post-build check has **11**: three `TextEncoder` type errors in
  `tests/commands/file/text-bound.test.ts` and eight diagnostics from flattened
  historical `.ts` captures in `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/`.
  The other nineteen cold errors are missing built declarations and cascades in
  three atomic-WebDAV consumer files. Exact paths/lines/codes are recorded; neither
  config nor consumers were changed. Global typecheck does not pass.
- Repaired explicit current-consumer runner at this candidate exits zero:
  **18 strict groups, 29 inputs, 16 emitted programs**, including actual emitted
  `.mts` runtimes, atomic injected consumer, WebDAV **13/13**, timestamp **20 controls
  plus 3 mutants**, S3 constructor **6/6**, and the two exact negative-type groups.
  This is service-free coverage, not deployed-server acceptance.
  Both committed canonical `.test.mts` files execute explicitly:
  `tests/fs/webdav/consumer/consumer.test.mts` and
  `tests/fs/webdav/release-timestamp-independent/independent.test.mts`.
  There is no literal file named `runtime.mts` in this candidate.
- Independently invoked existing packed/moved verifier at this candidate:
  **199/199 selected source tests; 13/13 public tests twice; six negative-type
  controls and five missing-runtime/source-access denials**. Strict production
  and external consumer types pass; the explicit registry is **70 defaults**.
  Packed dist matches this build, no repository-source fallback, zero runtime
  dependencies. Curl and SafeJS remain optional. This does not repair global types.
- Actual SafeJS engine came from private HEAD
  `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`: **264 regular files**, tree SHA
  `e1bbb8110c1b917f3ef78df2e7594a4a7b89e3851bc0903e247f78d1b80148fb`, copied
  into an isolated temporary directory. Import guards reject private/repository
  fallback. Availability executes the copied engine; no engine-unavailable skips
  occur in this capture. No proposal patch is applied. Private HEAD, status, index
  and all copied source hashes match afterwards; no private checkout was modified.

Node 22.22.2 / TypeScript 5.9.3 / Darwin arm64. GNU captures here are the recorded
Darwin builds, not a claim about GNU/Linux. The main capture and both focused
runs report clean supervised processes; their temporary trees were removed.
The separate packed verifier cleaned its exact workspace. The explicit-consumer
result was copied before its exact owned run directory was removed.

## Later explicit byte cohort

Root relayed fixture-only v2 `93a068bc`, trace `20235a6f`, independent `69b03a10`,
signoff `ce58e3dd`: moved `b2821599` cohort **24/24 + six controls**. Its other
23 cases are byte-identical; the abort schedule is unchanged. Two producer calls
are correct because an in-flight second empty yield precedes abort rejection and
closure checking, while only the first chunk is delivered. Historical 83 artifacts,
21/24 and 23/24 remain preserved. See the abort-count-v2-review report.

That v2 report is **not rerun here** and is not part of this older snapshot. Neither
old nor revised `public.mjs` belongs to canonical `.test.ts` discovery. Keep it an
explicit separately accepted cohort. Do not confuse it with the distinct canonical
`direct-curl.test.ts` artifact writer above.

## Reproduction and byte preservation

`run.mjs` is the original invalidated combined attempt, **not a repaired qualified
gate**. `diagnose.mjs OUTPUT` reproduces bounded focused checks in new frozen copies.
Output directories must not exist. All runtime source remains read-only.

`EVIDENCE_MANIFEST.json` authenticates original byte lengths/SHA256 and stored
representations. Large captures are gzip+base64 `.data` files so they cannot enter
TypeScript/test discovery; decoding is lossless, including final-newline state.
`node tests/integration/full-gate-20260827/combined-b494675c/verify-evidence.mjs`
checks every capture and all 307 failure/13 skip rows against the original TAP
accounting. Raw streams, imports, prerequisites, source hashes, earlier failed
attempts, private-after proof, focused diagnostics, and separate public results
remain available. No full-product acceptance or superiority claim is made.
