# Shadowed array method serialization follow-up

## Scope and first-check decision

Date: August 29, 2026. Direct delegated author; no nested delegation.

Create `/Users/kjopek/Workspace/poe-code-safejs-shadowed-array-checkpoint` from the
publisher origin on main and immediately pull before editing. The pinned base is
`64a1d91b5de0049b390efa7156be2fb41ef7a0d0`. NUM001 is already upstream at ancestor
`32caeaddbac72bccea1cb3fd0a07fb293a1bee71`.

The frozen Aquinas finding manifest SHA-256 is
`b0180aa4b983af140d713e51a17360aec6dc501f9928cb9fd1be9832b9dcffcf`.
Its exact benign source is `const values = [1]; values.map = 0; return 1;`.
Current main and native execution return 1, but completed-result `dump()` on main
throws `TypeError: value.map is not a function`. The dense control serializes and
replays. All four captured source-function, undefined, zero, and null own-map
variants also reproduce the completed serialization failure on current main.

Before adding any owned code, verify and apply the exact twelve-file OBJ002
publication prerequisite with manifest SHA-256
`e64ac49153e4e0d951ee8439cd2c1ffd4090bf0b3d085ec559eee5db44f9b120`.
All five existing preimages match current main; seven paths are absent as expected.
Use minimal `apply_patch` hunks and preserve all twelve approved postimages exactly.
The minimal finding, dense control, and four captured variants then serialize
successfully; the minimal/control completed snapshots replay to native results.

**Queued OBJ002 already fixes this finding. No new production repair is needed.**
Its graph-depth traversal reads actual enumerable data descriptors instead of
calling `value.map`. Its array representation routes named properties through
length/entries records, preserving shadowing data rather than invoking or dropping
it. Do not add another traversal helper, alter production, or change approved tests.

This is a separately recorded benign OBJ002/ARRAY follow-up, not an intentional
restriction. Original-47 membership remains unconfirmed; no new ledger ID or
additional root-cause count is invented. No original audit payload is needed or
read: only the explicitly captured benign finding source and contracts are used.

## Regression plan

Add only `packages/safejs/src/snapshot/shadowed-array-methods.test.ts` and this plan.
Keep the twelve-file OBJ prerequisite separate from the two-file follow-up delta.

- Preserve the exact minimal source, dense control, and four captured sources in
  public `run` / completed `dump` / `restore` / replay comparisons with native.
- Cover source-method shadowing alongside sparse named metadata without invoking
  that method during serialization.
- Exercise both interpreter and dump serializers with own `map`, `forEach`,
  `entries`, `values`, `keys`, and `slice` data; include null and present undefined.
- Assert length, exact own keys, holes versus present undefined, detached storage,
  indexed and named aliases, metadata/raw aliases, and self-cycles. Compare native
  structured-clone shape as well as explicit expected invariants.
- Prove the owned tests RED against the five current-main production preimages,
  then restore the exact prerequisite and prove GREEN without changing assertions.
- Run full owned-test types, all prerequisite-test types, configured types/lints,
  publishable formatting, focused/adjacent/full gates, and forced build with TERM
  unset. Preserve failures and exact diagnoses rather than weakening assertions.

Tests use only bounded native evaluation and pure in-memory runtime/serializer
fixtures. There is no filesystem, real LLM, guest IO, timing wait, new security
testing, or unsupported-method workaround in the regression suite.

## Coordination and handoff

Inspect only the frozen AR final manifest
`2df0a5d3adb477933055dcabd9988e6aa25f5893f3965f771dc47719b947d1d7`
and PPR2 provisional manifest
`532adf40516da33ba2a66f04298e472e1f6ae42fcd90d04573c0f11fd7f32d22`
and any explicitly referenced frozen pre/postimages needed to establish overlaps.
Do not inspect racing live clone files or treat provisional PPR2 as approved.
Record exact path and preimage relationships before freezing this follow-up.

Freeze exact prerequisite copies and current preimages separately from the owned
two-file delta, explicit absent-path records, commands, outputs, overlap proof,
and hashes under ignored `out/safejs-remediation/shadowed-array-checkpoint/`.
Existing captures, other clones, the original workspace, README files, branches,
commits, and pushes are untouched. No home configuration or skills are edited.
Initial npm installation/build invocations used ambient cache settings, so this
run cannot certify absence of npm home-cache/log writes. Remaining npm invocations
pin their cache to the new clone's ignored output directory; no home files are
removed or rewritten to conceal that qualification. Independent Aquinas review follows;
publication and a future combined publisher full gate are not authorized here.

## Verified frozen overlaps

The owned follow-up contains no production file, so it has no production-path
overlap with OBJ002, AR, or PPR2. Its new test and plan paths also do not overlap
any of their publishables. The prerequisite relationships remain explicit:

- OBJ002 versus AR: no production-path intersection. AR changes
  `packages/safejs/src/snapshot/dump.ts`, not OBJ's
  `packages/safejs/src/snapshot/dump-format.ts`.
- OBJ002 versus PPR2: exactly
  `packages/safejs/src/snapshot/dump-format.ts`. PPR's frozen ordered preimage
  SHA-256 `ab30f29e1cab5761e189b5cc114c463a3d7b221fe72ad1a91cda754e6d2cc1af`
  equals the approved OBJ postimage. The frozen PPR delta changes only the
  execution-semantics marker from `jobs-v6` to `jobs-v7`, leaving the OBJ array
  representation and traversal unchanged.
- AR versus PPR2: exactly `packages/safejs/src/run.ts`. PPR's ordered preimage
  SHA-256 `124d7f1f4ae72650ae0387e28f7f7adcd05f1027dfa3d3c833764babf8ce7662`
  equals AR's frozen final postimage.
- PPR's `packages/safejs/src/restore.ts` and OBJ's
  `packages/safejs/src/snapshot/restore.ts` are distinct paths.

All path comparisons use verified frozen manifests. Only PPR's two frozen
dump-format pre/postimages are read to verify the precise hunk; no racing live
clone file is inspected. No AR/PPR stack is staged for this test-only follow-up.
The captured PPR status remains provisional and broad-red pending its separate
oracle review. Nothing here certifies that candidate or replaces the publisher's
future combined gate.

## Executed validation

The final owned assertions produce **22 failures and one passing dense control**
with the five existing production files temporarily restored to their exact main
preimages using `apply_patch`. The new prerequisite array helper remains present
but is not imported by those baseline files. Restore the exact approved OBJ
production hunks, without changing any assertion: **23/23 owned tests pass**.
The public failures retain `value.map is not a function`; other sparse controls
also retain the original `undefined is not iterable` graph-depth failure.

All twelve OBJ prerequisite files remain byte-identical to the approved capture.
No approved author or validator assertion/report is edited. The final native
comparisons include all six captured/control public sources and the additional
sparse source-method composition. Both serializer formats retain exact keys,
own shadow data, explicit undefined versus holes, length, aliases, and cycles.
The public source-method composition additionally checks serialized `calls: 0`,
so the no-invocation assertion is not only about a previously returned value.

Results on pinned main plus the exact prerequisite and two-file follow-up:

- Owned plus all three prerequisite test files: **67 passed**, four files.
- Adjacent snapshot/interpreter/run/restore/dump/array-own/call-order gate:
  **3,716 passed**, 67 files.
- Entire SafeJS package: **6,518 passed, 39 skipped**, 173 passing files and one
  skipped file.
- Forced full repository suite with TERM unset and a clone-local npm cache:
  **23,903 passed, 41 skipped**, 963 passing files and three skipped files;
  one successful uncached task, 4m6.156s.
- Strict explicit TypeScript roots covering the owned test and all three OBJ
  test files: **zero diagnostics**. The package-configured TypeScript program
  with those same four test roots also reports **zero diagnostics**. Configured
  package and root source types pass; no suppressions or narrowed validation.
- Configured ESLint, workflow lint, and all 17 package-lint rules pass. All
  fourteen unique prerequisite/follow-up paths pass Prettier and whitespace
  checks. No unrelated file is formatted.
- Initial base and combined forced builds pass all 67 tasks. After all runtime
  suites finish, a final forced build with the clone-local npm cache again passes
  **67/67 tasks, zero cached**, followed by the configured test-root and root
  source type gates. Builds never overlap typechecks or runtime drivers.

The repository-wide format command remains exit 1 with **1,434 unchanged baseline
warnings**. Its full output and path-by-path diagnosis show no warned tracked
candidate change, no warned untracked candidate file, and no scanned output-tree
file. Expected RED commands and the ambient-cache operational qualification are
preserved alongside GREEN records; neither is silently relabeled as success.

## Final scope and review boundary

Freeze a separate twelve-file OBJ prerequisite patch with five existing main
preimages and seven absent-path records. Freeze only the new test and this plan
as the follow-up delta, with both main/post-prerequisite preimages explicitly
absent. Check forward and reverse patch applicability at the appropriate stages.
Build-generated terminal-pilot font assets and the mutable clone-local command
cache are not publishables. The frozen evidence tree is read-only and macOS
immutable; working source remains editable.

This demonstrates that the already approved OBJ002 representation fix covers the
new benign finding; it does not create another production fix or certify all
array-own behavior. Non-enumerables, symbols, descriptor-flag preservation,
accessors, opaque host functions, old-reader compatibility, and the separate
provisional PPR oracle remain outside this result. No original-47 membership is
assigned. Independent Aquinas review and any later publisher integration remain
pending; there is no publication authorization.
