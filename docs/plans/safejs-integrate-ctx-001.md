# CTX-001 ordered integration

## Isolation and provenance

- Date: 2026-08-29. Direct delegated author; no nested delegation.
- Fresh main clone from publisher origin, immediately pulled before inspection.
  Pinned base: `32caeaddbac72bccea1cb3fd0a07fb293a1bee71`.
- The initial CTX prep remains frozen. Priority LANG integration is separately
  frozen for independent Aquinas review, manifest SHA-256
  `aa0da0315f7e77b30e527dbfa6aaed065fb5c687d28b975c3a0ae817531fa68e`.
- Restore exactly 38 archive exclusions and the entire audit security directory
  before payload reads. Use explicit nonexcluded allowlists and hash-verified
  immutable captures only. No original writes, excluded reads/hashes/execution,
  recursive audit scans, live/racing AR reads, guest IO, or real LLM calls.
- No branches, commits, pushes, README edits, or changes to other clones.
  Preserve unrelated files and published behavior; apply surgical deltas only.

## Verified prerequisite state

Evidence resides in ignored `out/safejs-remediation/ctx-001-ordered-prep/`.

- The unchanged CTX validation candidate has manifest SHA-256
  `ded61063458521da5da7c84e1071770eceaaf29b61b485ecfe10e49ea1639f7f`.
  Its five production paths are array/map/set methods, object-array globals,
  and the interpreter. Both existing test files are copied byte-exact.
- NUM's five production postimages already match current main exactly. Do not
  reapply or bundle NUM. The publisher confirmed this main commit as NUM's receipt.
- Current object-array globals differ from the old CTX preimage: preserve published
  alias handling and iterable Object.fromEntries support. Current SHA-256:
  `dbf2fddfb2a5fc7c11ddfabdb30f4a29ec324938a014c8b9e536320f649f1621`.
- Current array methods retain the published own-property lookup. Their SHA-256 is
  `6de97e76745d9bac348957c78717c7dda4766385ce004f92ce49d71202e874ba`.
  Apply LANG's array-local reader lifetime delta before CTX; never replace the
  current file with either old whole-file candidate. LANG's integrated postimage
  is `00ed651f1d5a526b270210a25ef483960bb791066a11d4319aba0e168543efee`.
- Current interpreter SHA-256 is
  `50175cb793ecf85ce80cf0e7f0d2667680090eed8c70c20c1f9158e6cab8cbdb`.
  This matches the approved AW prerequisite preimage exactly. AW changes it to
  `f3b7c19f4ef98ec757e40d8a8c8a6d372329f80c5a12f8617b41ea198b01b132`.
  AW also changes exceptions.ts. Preserve both AW files; CTX's receiver forwarding
  hunks are distinct from AW's exception ownership/propagation hunks.
- Map and set method files still match their old CTX preimages byte-for-byte.

## AR and prerequisite overlap

Verified frozen AR author integration manifest SHA-256:
`00b70bbff15d78106a722fc184ccbf4c2f5c0f7a629efcd96e5c3c75a1a55378`.
Its adjacent report and four prerequisite manifests are hash-verified metadata.
Nash's fresh independent review remains pending; no author metadata is treated as
independent approval.

- AR's four production paths are run.ts, snapshot/dump.ts, interp/host-bridge.ts,
  and runner/signal-dump.ts. None directly overlaps the five CTX production paths.
- Among NUM, AW, OBJ002, and CBI, only AW's interpreter.ts directly overlaps CTX.
- NUM then OBJ002 both change snapshot/restore.ts. CBI then AR both change
  interp/host-bridge.ts. These are separate ordering constraints, not CTX hunks.
- LANG is a separate prerequisite absent from the AR layer list and directly
  overlaps CTX array methods. Final CTX validation must cover the declared ordered
  state, including semantic checkpoint interactions even where file paths differ.
- Subsequent parent clarification identifies PPR as separate pending-promise fixes.
  Verified metadata pins are PPR1
  `54badea70ab409d883a8252e6d11604d648d3a501d5c1d2ff63adc73c15f8fec`
  and PPR2 `64b0d70928472558f48bfedeae6699cabd3107c44ef682c2a7a66b01da56cb32`.
  PPR1 changes interp/values.ts and interp/host-bridge.ts. PPR2 changes run.ts,
  snapshot/dump-format.ts, snapshot/migration.ts, and restore.ts. None overlaps
  CTX's five production paths. Only their immutable manifest metadata is read.
- The parent authorizes CTX before PPR. Stage only LANG and AW on pinned main;
  do not stage AR, PPR1, PPR2, OBJ002, or CBI. No final PPR composite is claimed.

## Execution steps

1. Preserve current-main preimages and exact old/current production comparisons.
2. Run the unchanged 141 author and 37 independent tests against genuine current
   main before production edits; capture the full RED failure evidence.
3. Establish full native outputs for the three unchanged original controls twice,
   including positive-zero and identity flags, and capture current-main failures.
4. Stage exact LANG and AW runtime/test prerequisites only; preserve published NUM
   and OBJ003. Keep prerequisites separate from the CTX-owned publication delta.
5. Apply minimal shared callback receiver forwarding through actual thisArg
   positions; preserve reduce initialValue, arrow lexical this, and bound this.
6. Rerun all 178 inherited tests, 18 full original native/current/completed-replay
   comparisons, active checkpoints and cross-fix cases after genuine ordered RED.
7. Run focused, broader and full tests with TERM unset and snapshot playback/miss
   errors; configured source/test types, ESLint, changed-file Prettier, and builds.
8. Freeze a delta-only candidate with ordered preimages, source/tests/plan, hashes,
   all evidence and retained failures for independent review. No publication claim.

## Preparation results

The earlier prep is frozen separately at `ctx-001-ordered-prep/prep-manifest.json`,
SHA-256 `d525415ee3ca46b306618205a971746f791994571c3c61bf2739e4d28ebbc244`.
Installation with `SKIP_SYNC_SKILLS=1 npm ci` passes; unchanged-main workspace build
passes all 67 tasks.

- Genuine current-main RED: 110 failed / 68 passed of the unchanged 178 tests,
  with five captured rejection errors. The complete failure log is retained.
- Three unchanged original sources, each twice: six native full-output matches,
  four supplied-thisArg failures, two explicit-call current full-output matches,
  and two completed control replay matches. Positive-zero anchors also match.
- Both inherited oracle files remain byte-identical to the validated candidate.
- All five current NUM production files match their approved postimages. AR itself
  has no direct CTX production overlap; the AW prerequisite and separate LANG fix
  do overlap CTX. Preserve published object-array globals and array own lookup.
- The initial request for a separate PPR pin is resolved by the subsequent metadata
  comparison and parent authorization above; no PPR payload is needed.
- The earlier LANG candidate remains immutable and is not modified by CTX prep.
  Build-generated terminal-pilot assets remain outside any candidate delta.

## Surgical integration and TDD

New evidence is isolated in ignored `out/safejs-remediation/ctx-001-integration/`.
Three prerequisite production files and six prerequisite test files are staged
byte-exact from the frozen LANG and AW captures. Prerequisite plans are not copied
into the working tree or bundled into the CTX delta. Main remains pinned; no pull
or unrelated change occurs after staging.

- Genuine prerequisite RED: 120 failed / 514 passed of 634 tests, with five captured
  rejection errors. All 446 LANG/AW prerequisite tests pass, while the unchanged CTX
  oracle has 110 failures and all ten new cross-fix tests fail.
- Prerequisite original RED repeats the three unchanged sources twice: six native
  matches, four thisArg failures, two explicit-call matches and two control replays.
- Apply only the original validated CTX's receiver-forwarding hunks to the five
  ordered production preimages via apply_patch. Never overwrite old whole files.
- Shared array callback dispatch forwards the explicit receiver through callback
  helpers and interpreter invocation. Map/Set forEach use argument two; Array.from
  uses argument three. Reduce initialValue and comparator extra arguments remain
  untouched. Source invocation still owns arrow lexical this and bound this.
- Candidate focused GREEN: all 634 pass, comprising 141 unchanged author, 37
  unchanged independent, ten new integration, and 446 prerequisite tests.
- New native/current/replay cases cover nested aliases and distinct receivers,
  arrow/bound binding and NUM arity, reduce initialValue, published Object.entries
  aliases and Object.fromEntries iterables, own array properties, AW source throws
  with receiver identity and guard release, and active aliased checkpoint replay.
- Built-candidate original GREEN: all 18 full comparisons pass, consisting of six
  native, six current and six completed replay runs over the unchanged sources.
  Positive-zero anchors and every output/context/array identity flag match.
- Broader SafeJS suite: 176 files passed / one skipped; 6,893 tests passed / 39
  skipped. Full root suite: 966 files passed / three skipped; 24,278 tests passed /
  41 skipped in 226.39 seconds. All tests use `env -u TERM`, snapshot playback,
  and snapshot misses as errors. No failing GREEN gate is waived.
- Root build passes all 67 workspace tasks, schema generation, root TypeScript,
  bin wrappers and bundle generation. Root/package types and an explicit config
  covering all nine added CTX/LANG/AW test files pass without option relaxation.
- Configured ESLint passes, excluding only this clone's ignored remediation
  evidence. Configured Prettier passes across all staged source, tests and plan;
  `git diff --check` passes. No prerequisite or inherited oracle is reformatted.
- Exact three-way comparison confirms all five source files contain only the
  validated CTX delta on the ordered preimages: 104 insertions / 43 deletions.
  The two inherited CTX tests, six prerequisite tests and AW exceptions.ts remain
  byte-identical. All five NUM production files and nonoverlapping AR production
  paths remain byte-identical to pinned main. No unrelated tracked change exists.
- Read-only forward patch checks pass for the prerequisite patch against main
  preimages and for the CTX production patch against ordered preimages. The final
  CTX-only patch also receives full forward and reverse checks before freezing.

## Candidate boundary and limitations

CTX owns exactly five production files, three tests and this integration plan.
Its five existing-file preimages are the ordered LANG/AW state, not bare main.
Prerequisite files and evidence remain separately identified; do not publish them
as part of CTX. Independent review of this integrated CTX delta is still required.

The inherited LANG integration tests retain four native/current-only cases for
own-map shadows because bare main's separate array serialization defect persists;
they are unchanged. CTX's ten new cross-fix cases all include replay. No ARRAYOWN
serialization, PPR, AR, OBJ002 or CBI composite fix is claimed. No guest IO, real
LLM, security research, original mutation, or visual CLI change is introduced.

## Frozen author handoff

Freeze only the exact CTX-owned delta as `candidate/ctx-001.delta.patch`, with nine
postimages, five ordered preimages, this plan, complete RED/GREEN/native evidence,
preservation checks and `candidate/hash-manifest.json`. Keep the LANG/AW staging
patch and captures separate. File-content hashes and live/captured byte equality
are verified; artifact files use read-only permissions and macOS immutable flags.

The publisher must enforce all five exact ordered preimage hashes before applying
the delta. A text-only patch check on bare main does not establish prerequisite
presence. Status: author-ready for fresh independent CTX review on pinned main plus
LANG and AW, not publication authorization and not a final PPR composite.
