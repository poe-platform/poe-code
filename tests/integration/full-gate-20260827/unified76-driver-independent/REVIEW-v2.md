# Independent unified76 review v2 — HOLD

**F01 is resolved for selected BASE44 metadata authority only. Final candidate
admission and driver runtime acceptance remain HOLD. All frozen A01–A22 groups
remain NOT_EXECUTED.** Only ten separately named independent pure metadata
predicate controls were executed in this resume.

## Authority and chronology

- Approved additive authority: `add4e9db6d8c9b946cf1c854562c4d6b56241890`,
  `tests/integration/full-gate-20260827/unified76-driver/MTS-AUTHORITY.json`.
- Present predicate base: `44f00bf84278e3361b52106478d59c707ab7b2bc`.
- Inspected driver: `86f75025b423f9d25a9dbcb35d07e73e95d33f9d`.
- Superseded packet: `07047e8f7bd577f60350246b1380732712305f58`, tree
  `f2b9afdbaafee930e188fa4d216e6779a2fbed75`, source tree
  `5876c6bf4ad9bc07f22cc46f8dbee99461981862`.
- First successor body read: **August 27, 2026, 19:48:41 CDT**, or
  **August 28, 00:48:41 UTC**, under the resumed explicit authorization.
  Earlier artifacts `7f98f745ffbf14da484ca3867ebf09cfa18841a2` and
  `148d77b2f2a30d7e24a29e977dc9104cd02d1113` remain unchanged. Their preinspection
  chronology is not retrospectively changed; author files already existed then.

The source/hash manifest and exact static mutation fixtures are
`AUTHORITY-v2.json`. It is additive, not a replacement for PHASE-A, PHASE-B,
RECEIPT or integrityvalidation. No unfrozen live body, product import, author
module import, candidate admission, reconstruction, build, pack, types, native
oracle, private checkout or full gate was executed.

## F01: checked, not suppressed

The selected checker at
`tests/plugins/qualified-current-release/inventory-check.mjs:15` enforces
`entry.sha256` equality only for **non-current** entries. Lines8–9 require
current/negative path routes; lines16–21 retain nested frozen-evidence checks.
The same non-current rule is present at policy introduction
`02704bd1291b83763d7360b97bc5c6d50403ad10`, before the timestamp helper change.
This is not a newly invented exception to admit a mismatch.

`tests/fs/webdav/consumer/provider.mts` is CURRENT, group `webdav-loopback`:

- Retained informational inventory SHA-256:
  `288d17dca5b6950fababb945cf21c15594dfbf37897d1cdcaab2aba1088a6b9b`.
- Actual selected44 source SHA-256:
  `af9ffdb0f991696818512c5f50dab94fdb76387d3b66a2abca80fb799d6d30b6`.
- Actual Git blob: `21f5fe464f028b4e056d2aae40b26612f560bd95`,10948 bytes.

All six lineage records in the approved authority were independently checked
against pinned Git blob bytes/SHA-1/SHA-256/size. The old6603-byte provider becomes
the new10948-byte helper at `456a0738b0d2dc130ebbd9b7ccf5e299bcf177da`; selected44
and superseded070 have that same new blob. No timestamp behavior or provider
service claim was re-executed. The original191 equal/1 unequal field observation
and original static exit1 remain true and retained.

Routes were read, not imported:

- `tests/plugins/qualified-current-release/consumers.mjs:1` constructs full file
  paths; line17 includes provider with consumer.test/example/types in
  `webdav-loopback`, runtime `consumer.test.mjs`.
- `scripts/verify-current-consumers.mjs:88` copies and byte-checks group inputs
  and companions; lines105–118 compile and dispatch the declared runtime;
  line125 requires13 loopback tests.
- `tests/plugins/qualified-current-release/consumers.mjs:32` declares provider
  as the `webdav-timestamp-independent` companion with23 tests, qualified as20
  controls+3 mutant kills. This is not23 provider successes.

The v2 predicate requires the reviewed current route **and actual BASE44
revision/blob/digest**. It never uses the stale field as executable identity.
For NONCURRENT, recorded inventory hashes remain mandatory; classification
changes cannot evade them. The two hashes and original exit1 are not erased.
Only these provider/companion routes were inspected substantively; matching192
authority-row memberships does not validate all current runtime routes or all
nested historical evidence. The final candidate must receive a new binding.

## Independent static controls and evidence

Command (ambient Node `v22.22.2`, not a gate runtime claim):

```text
node tests/integration/full-gate-20260827/unified76-driver-independent/static-predicate-v2.mjs --verify
```

Exit **0**; output status `F01_BASE_METADATA_AUTHORITY_RESOLVED_ONLY`,
finalCandidate `HOLD_NEW_PACKET`. All10 pure metadata outcomes matched:

| ID | Independent input | Required/observed verdict |
| --- | --- | --- |
| P01 | Exact CURRENT base bytes and reviewed route; retained old field | ACCEPT_BASE_METADATA |
| P02 | Wrong current group | REJECT_CURRENT_ROUTE |
| P03 | Remove provider from current route | REJECT_CURRENT_ROUTE |
| P04 | Wrong actual selected Git blob | REJECT_SELECTED_BLOB |
| P05 | Substitute old inventory SHA as actual current bytes | REJECT_SELECTED_DIGEST |
| P06 | Substitute superseded candidate for present BASE44 predicate | REJECT_SELECTED_REVISION |
| P07 | Exact NONCURRENT frozen-evidence control | ACCEPT_BASE_METADATA |
| P08 | Wrong NONCURRENT actual hash | REJECT_NONCURRENT_HASH |
| P09 | Rewrite NONCURRENT recorded hash | REJECT_INVENTORY_RECORD |
| P10 | Reclassify NONCURRENT as CURRENT | REJECT_CLASSIFICATION |

These are **not** A01–A22 executions, author control replays or source/runtime
acceptance. The static command also verified all four original owned artifacts
against their freeze commits, exact192 authority/inventory row membership and
classification/recorded-hash metadata, two selected-base control blobs, the six
provider lineage records and11 driver seal file hashes. It did not independently
rehash all192 actual source blobs in this resume.

The11-file `DRIVER.json` seal's canonical-JSON digest matches AUTHOR-EVIDENCE:
`436e11579c0f4096d4f11ea83272c3af2f276ee94bbd972eccfd8eabbdd51553`.
Encoded profile digest
`adea62d151c64794bb591ce0c414c182ba80acf324438ac4628011144777bec0`
and encoded raw digest
`64308da952f0aa3ce8bcea3ccfb1762725241b3d176340febb0d1f15f6d08dc6`
match pinned blobs. They were hashed in streaming chunks without decoding either
bundle or buffering an archive. Ordinary collected Git blobs are limited to
512KiB, hash-only streams to2MiB, each Git child to15 seconds; children are awaited.

Author reports **54/0**, **13/0**, **7/0** controls, with earlier package6/7 failure
retained, plus fixture58/10 original and67/1 revised. These remain **AUTHOR**
outcomes. This leaf verified outer identities, not the6,339,582-byte raw payload's
45 inner artifact contents or test semantics. Reported full-product package
`c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`
was not opened, recreated or imported. Original Meitner71/7 remains historical.

## Bounded driver inspection against frozen groups

Paths in this table are under the pinned86 `unified76-driver/`, unless stated
otherwise. Entries describe source-visible behavior, **not passing controls**.

| Frozen group | Source-visible observation and remaining boundary |
| --- | --- |
| A01 candidate/admission | `common.mjs:47` checks base/src/tree/parent/raw commit and changed paths; `admission.mjs:19` requires a release receipt matching seal/profile/package and public/independent approvals. Current070 packet is superseded, not admitted. |
| A02 four-fixture proof | `common.mjs:54` applies exact recorded replacements and compares bytes. The pinned four-path receipt lacks the newly approved first public-count hunk. Root's extra hunk must be separately frozen; original67/1 is retained. |
| A03 runtime source guard | `profile.mjs:57` requires full scope metadata equality with Git; `run.mjs:48–49,78–82` verifies extracted files and uses namespace guards. This covers more than typing inputs; host/tool inputs remain outside that Git closure. |
| A04 transitive/generated inputs | Full37397-tree plus ancestor Git objects is declared, not compact4579. `common.mjs:29` copies live installed dependencies; `run.mjs:56` checks versions, not a prior byte manifest. Host npm library tree is allowed at71 but only npm CLI itself is hash-observed at81. See R2. |
| A05 inventories | `profile.mjs:61–70` specifies exact canonical selection,192 classifications and256 cleanup paths; known counts632/192/256 are assertions, not execution evidence. Profile payload was not decoded or validator invoked here. |
| A06 origin/no fallback | `inventory.mjs:50–55` checks regular files versus declared links and Git bytes; copied dependency files disallow symlinks except rebuilt .bin wrappers. Explicit host dependencies and live pre-admission support reads require separately bound origins; not proof of arbitrary no-live fallback. |
| A07 Node identity | `common.mjs:16` pins the Node24 path; `admission.mjs:36` calls inherited runtime inspection; `run.mjs:72,82,90` checks guarded probe/hash/observed children. No executable/host probe performed by this leaf; inherited implementation not fully reviewed. |
| A08 permissions/loader | Canonical phases get guard via NODE_OPTIONS plus tsx argv; permission flags appear on probes/public runtime. `run.mjs:86,106` explicitly acknowledges nested environments not universally inheriting the outer hook. Exact per-phase fences/grants need binding, not a universal claim. |
| A09 TAP argv | `admission.mjs:11–12` defines and compares explicit `--test-reporter=tap` and concurrency2 before canonical operands. `run.mjs:89` calls the accountant. Parser/strict verdict behavior not exercised. |
| A10 one build | `run.mjs:97` asserts one typecheck:all build, then105–106 deliberately calls a separately building current-consumer runner. Base `scripts/verify-current-consumers.mjs:72` confirms the second production build. Literal single-build requirement remains unresolved; see R4. |
| A11 full package | `run.mjs:107–124` packs source, checks c109, moves installed package, applies public/type/missing-file checks and sweeps. Smoke includes a literal76 set and HTML/DU/expr root/subpath checks; public wildcard exports are skipped by `public.mjs:12`, not a complete expanded31-export proof. |
| A12 streamed/resources | `run.mjs:15–26,48–51` pipes full archive/history; no full tarBuffer there. Setup stderr strings grow without a byte cap, transport has no byte/disk/member ceiling, and `run.mjs:80` later reads each entire selected file for hashing. See R3; inventory streaming alone is insufficient. |
| A13 archive safety | `inventory.mjs:42–55` checks membership/directories/modes/link containment after `/usr/bin/tar` extraction. A pre-extraction entry/path/link rejection stage is not visible. Git archive/history spawns inherit ambient process environment, unlike `common.mjs` Git calls with --no-replace-objects. No malicious archive was executed. |
| A14 freeze/output growth | Namespace capture includes directories/types/modes/link targets and comparisons detect added/removed entries; `requireBuildDelta` allows only new dist before final baseline. This is boundary integrity, not prevention of transient/restored writes or an ABA defense. |
| A15 native prerequisites | `profile.mjs:76–79` compares49 original assets plus expr/du extension identities; `run.mjs:31` rejects prerequisite issues78. No native execution/availability/versions/library assessment or51-binary parity claimed. |
| A16 cleanup256 | `profile.mjs:67–70` binds exact cleanup paths/hash/revision/tree; `run.mjs:69–70,82` writes and checks COMMIT/EXPECTED. Packet envelope digest is reported0fb7..., different from earlier base draft6fee...; new candidate must rebind. No awaiting behavior executed. |
| A17 process lifecycle | Inherited supervisor excerpts show256MiB output bound, backpressure, signals and survivor checks; `run.mjs:125` includes clean flags. Setup transports supervise only their direct children and several synchronous setup/probe calls have no explicit deadline. No leak/timeout/forced-cleanup controls run; no SIGSTOP seen in reviewed surfaces. |
| A18 cooperative cleanup | Binding the three cleanup test/helper paths does not establish registered-before-acquisition or opaque/cooperative settlement semantics. Product implementation and cleanup test behavior were not reviewed/executed here. |
| A19 strict evidence/verdict | Raw phase logs/status and reconciliation are retained, but `run.mjs:125` accepts reconciliation rather than explicit zero failed/skipped/todo. A `qualified-red-measurement` does not itself set nonzero process.exitCode; see R6. This is not inferred strict-gate acceptance. |
| A20 explicit/import-safe entry | Actual CLI is `--execute ... --release ... --committed-archive`, not frozen `--run`. `run.mjs:28` executes top-level parsing/admission; importing it can perform setup preflight with matching argv. `fixture-proof.mjs` and `reconstruct.mjs` also have top-level effects. Narrow helper modules differ; see R5. None was imported. |
| A21 classification | F01 v2 keeps current-route/selected-Git authority and noncurrent hashes. Profile classified rows retain inventory metadata plus actual Git blob; no captured-data waiver, inventory rewrite or current/public acceptance follows. |
| A22 history/version | Original freezes and all old results remain intact. The ten v2 independent static predicates do not convert any old seven binding case or frozen22 driver group into an executed result. |

## Seven routed questions, no local scope expansion

**R1 — exact final hunk and packet (root/Curie).** Route final candidate/tree,
four-path before/after blobs and reversible patch, new driver/seal/profile/cleanup
identities. Public fixture at superseded070 lines25/31/32/34 still has a73 title,
two73 counts and a trailing literal list ending at column. The approved extra
hunk at31 must state its exact treatment of that block; this leaf does not infer
permission for arbitrary name-list changes. Custom fixture remains77; no fifth
path. Original67/1 is not rescored and public HTML/DU/expr acceptance remains separate.

**R2 — external runtime/tool closure (Curie/root).** The conservative full Git
tree solves the earlier typing-only selection problem for committed files; it
does not freeze installed dependencies, benchmark dependencies, host npm's
transitive library tree, PATH shell/Git/tar or all inherited pre-admission support
imports. Supply exact trusted host-origin/hash manifests or a precise approved
boundary, plus per-phase Node/loader/permission grants and nested-child fences.
Version equality and a post-copy baseline are not prior immutable identity.
No broad source edits or a new compact selector are requested.

**R3 — resource/extraction/setup lifecycle (Curie/root).** State enforceable
archive/history/output/disk/chunk/member bounds, pre-extraction path/link authority,
bounded setup stderr, and streaming replacements for whole-file hash reads where
large inputs occur. Explain direct-child versus descendant cleanup, preparation
and synchronous probe deadlines, and ambient Git configuration/replacement handling.
`reconstruct.mjs:13` buffers a small *skeleton* pack, not the2.382GB full archive;
do not conflate that recipe with the streamed execution transport or claim its
import is inert. No reconstruction or hostile extraction was attempted here.

**R4 — literal build once (root/Curie).** Resolve the visible second build in
current-consumers before claiming the frozen one-build requirement. Reusing
the one authenticated emitted package would need owner work; alternatively any
scope clarification must be explicit root authority. This leaf does not silently
redefine one build as one build per subsystem. Keep c109 full-product identity
and pending expanded export/options/runtime acceptance separately qualified.

**R5 — CLI and import boundary (root/Curie).** Reconcile frozen explicit `--run`
with actual `--execute`, and identify the guaranteed import-safe helper surfaces.
The launcher has no main-module guard; parse/admission and logging/exit-state
effects are at top level. Author recipes are active scripts, not import-safe
helpers. Decide/version the contract or have the owner change code; do not
execute a module to discover whether it is safe.

**R6 — strict verdict and capability prerequisite (root).** Specify diagnostic
measurement versus release acceptance, failed/skipped/TODO disposition, and CLI
exit status when any phase produces a red measurement. Current final predicate
can label red without setting a failing exit code. SafeJS availability is a
mandatory phase in this driver; its inherited private prerequisite implementation
was not reviewed or authenticated here. No previous availability or private
access is authorized by this receipt. Supply the intended release policy rather
than treating reconciliation or outer author control counts as acceptance.

**R7 — final cleanup/proof packet (root/Curie).** Route selected-revision256
COMMIT/EXPECTED bytes and digest with root release identity, exact49+2 native
asset/profile binding and preserved cleanup/negative raw evidence. Include the
new driver controls/evidence that address the above questions; the old packet
and its author54/13/7 outcomes cannot certify forthcoming bytes. Registered
cooperative-work settlement versus opaque work still needs actual later scoped
acceptance, not this source-binding review.

## Deliberately unreviewed and handoff

Fully read pinned successor bodies: common, admission, profile, run, inventory,
public, fixture-proof, reconstruct, consumer.mts.fixture and negative.mts.fixture.
Inherited checker was fully read; consumers/dispatch/supervisor were inspected
only in the cited relevant excerpts. Hash verification is not substantive body
review of every transitive module. Not reviewed: the complete inherited runtime
guard/preflight/private prerequisite/accounting implementations, author control
drivers/assemble/freeze/restore/capture/authority helpers, inner compressed raw
artifacts, deployed providers or whole product. Missing inspection remains a
limit, not approval. No new framework or gate adapter is implemented.

Only new versioned files in the assigned independent directory were written.
Four original files are byte-identical to their freeze commits; no foreign
staging or artifacts were changed. All owned Git children/command sessions have
settled; no service or background worker was started. **Stop here awaiting the
new immutable packet.**
