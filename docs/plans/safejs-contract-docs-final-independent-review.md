# SafeJS 11.0.32 Contract Documentation: Independent Review

## Decision and scope

**READY for the four-file non-README documentation intake**, subject to root's
publication decision and final exact-preimage checks. This is a static contract
review, not a new runtime certification or acceptance of an unresolved feature
gap. No author repair is required within this documentation scope.
The F4 technical disposition is now a bounded modern canonical-replay
representation qualification. Its four whole-dump and two legacy-journal
comparison failures remain FAIL; no all-stack or legacy-only approval follows.

The independent clone is
`/Users/kjopek/Workspace/poe-code-safejs-contract-docs-final-review`. Clone and
immediate `git pull --ff-only` finish on main at
`4577774c8e777c0cb4f236816d2320b5f2ed0b06` with clean initial status. Applicable
workspace/root instructions are read. Nash's author base is separately pinned
at `3f996a58ecad69b5a797dbe446a08906797654a7`. The runtime remains released
`poe-code@11.0.32`, commit `93dda91e9d0d7078e7940ba51bf73a81ed7aec49`.

The author manifest is verified at SHA-256
`b3a662d79c71d6d5cb45534ff1b1dc966a51db7a02f2aebf3d4e6dcbd474481e`.
All 11 in-scope publication/evidence members match their declared hashes and
byte lengths. The two `proposals/` members are intentionally not read, hashed,
copied, or approved. Their metadata exclusion is not a failed verification.
No actual README or skill-template payload is opened or changed.

The contract's exact main preimage is SHA-256
`b3c62930c236e3f1b1c9f64236c12449a0bdf73b104fcee3e3566eba256108d0`,
14,435 bytes. It matches both Nash's captured preimage and this review's pulled
base. The two reports are absent at this base. Nash's contract postimage
`925aff82a7bb76e7f48297491923c52f2c3fc60be25926ceab01c54f4814dc9c`
and author-report postimage
`8afa3a0732467520e21272d49379552db2e5aad974c24c7ccdffb15dc864cd83`
were initially staged unchanged through `apply_patch`. The later authorized
19-line insertion is reviewed below; Nash's report remains unchanged. Only this
independent report is reviewer-authored.

## Static evidence map

The source/doc index independently rechecks all 27 scoped file hashes. Every
runtime source, pre-existing test, public contract dependency, and package
configuration in that index matches the released commit. The three later
additions are the O10 test and its two reports; they are identified as later
test/documentation artifacts, not files present in the released source tree.
Changes between the runtime pin and this review's main are docs/tests only.

- **Fresh v7 versus genuine v6:** `snapshot/dump-format.ts:2`, `restore.ts:51`,
  `run.ts:199`, and `run.promise-compatibility.test.ts:41` establish the current
  marker, explicit v6 acceptance, and retained v6 execution/dump path. Existing
  F6 observes fresh v7 on the actual released package. The documentation does
  not turn marker acceptance into completion of all histories or retroactively
  repair failing raw-v6 captures. Historical markers are not rewritten.
- **Completed outcomes and callback replay:** `host-call.ts` and the bridge
  distinguish delivery of saved outcomes from source callback reconstruction
  and `onReplay`. The introduction removes an overbroad noninvocation reading;
  it does not promise that no source callback or local restoration hook runs.
- **Genuine H5 conversion:** `host-bridge.ts:363` creates the active invocation
  context; `:376` checks its lifetime, and `:849` accepts functions only from
  that context's proof-function registry. `host-call.ts:56` and `:323` preserve
  proof identity and joined/detached disposition. The exact installed public
  declarations export `HostCallResumeContext.toSandboxValue`; their bytes are
  checked against F0's archive inventory without importing or executing them.
  Existing H5 tests at `test/h5-context-converter-review.test.ts:147`, `:253`,
  and `:298` cover conversion without invocation, foreign active contexts, and
  expiry. F2's actual released-package evidence uses this public converter,
  genuine requests, reconstructed callbacks, and consumed proofs. No private
  adapter, forged metadata, substitute function, or generic native-function
  acceptance is endorsed.
- **Callback arity:** `host-bridge.ts:707` retains the source closure length.
  `host-callback-arity.test.ts:108` and `:129` compare native default/rest/bound
  signatures and direct/array-property aliases. The documentation calls the old
  zero-length result corrected, not an accepted limitation, and deliberately
  does not promise all reflection/descriptor/property-write behavior.
- **Completed Map identity:** `snapshot/completed-map-alias.test.ts` and
  `docs/plans/safejs-review-completed-map-alias-final.md` preserve shared closure,
  object, Map/Set, and cycle observations. That historical independent report
  explicitly retains two restores of already-split captures as non-native.
  Current graph preservation is not a universal Map-operation claim or a repair
  of aliases absent from an old capture.
- **TOJSON and old-object reset:** `host-call.ts:765` builds inert own-data digest
  containers and omits callable values without replacing actual host arguments.
  The author TOJSON report at `:57` records old object/nested-object resets; the
  independent report's compatibility section records old plain-object refusals
  before host/provider calls and the named-array control's replay. These are
  retained bounded historical observations, not newly executed 11.0.32 cases.
  The new wording preserves that distinction, the numeric-array/callable digest
  policy, and reconciliation before any authorized restart. It does not promise
  universal noninvocation, a complete alias fingerprint, or automatic migration.
- **Raw versus serialized graphs:** `snapshot/backend.ts:55` queues the write;
  `:85` serializes inside that operation before its filesystem retry loop.
  The O10 test and independent report distinguish shallow retained bindings
  from earlier serialized bytes, with full graphs and 48 source plus 48 built
  fresh restores across six profiles. Those are prior observations, not a new
  execution or universal collection guarantee in this review.
- **Error channels and guest identity:** `run.ts`, `run.test.ts`, and
  `interp/source-exceptions-validation.test.ts` distinguish fulfilled result
  diagnostics, rejected execution promises, and guest `{ ok: false }` data.
  F6's actual package evidence retains rejected budget recovery and caught
  checked-error results. Source throw/catch record identity is explicitly
  separated from host copying and public normalization. No generic native-Error
  input or O12 proof projection limitation is reclassified here.
- **Generator example:** `run.snapshot.test.ts:613` contains the existing
  public run/dump/restore regression yielding `[1,2,3,4]`. The documentation
  cites that bounded source-generator result, not an internal experiment or
  arbitrary native/async generator-frame serialization.

All paths in this map are under `packages/safejs/` unless explicitly prefixed
with `docs/`. Source/test inspection is not described as fresh execution.

## Existing actual-package observations, not new execution

The following immutable manifest hashes are independently verified:

- F0: `09379aed7eb24e455729e605e53d89408523d731ffe8e8b3655ac76bfe02b674`.
- F2: `0f8cf2c856c1e8cd8a988aa09b4c2bb36c62de7f41905a1cc7f44046776e937d`.
- F6: `951bacece3fc3293fbbe9f305b4edbb62d4947dab6c1d5dc698076d9c4a49bfb`.
- O17: `79fdda8067a214506b1d6de03692f4d7484bab3dc27320d799d85954c7463096`.

F0 pins the actual released tarball and public entry/chunk inventory. F2 records
92 bounded children with their expected completion/refusal dispositions and
32 consumed genuine proofs. Its six future-settlement qualifications remain:
captured prefixes and declared recovery schedules are exact, but all future
chronology is not claimed equal to the original host delivery. Eight initial
observer-pairing mismatches are resolved by genuine call ID, not array order.
The eight historical watchdogs, twelve qualified O14 children, and 21 earlier
lint failures are retained, not relabelled as current passes. F6's earlier
22-check pass is reused only for the actual public behaviors it observed.

O17 remains **native-parity RED with user scope decision OPEN**: native 3/3,
source 0/3, released built 0/3, with API `ok: true` and guest `ok: false` in six
observations. Missing `Float32Array` availability is not called an accepted
limitation, established regression, or authorized feature implementation.
Neither this documentation approval nor the excluded proposal decides it.

The contract has zero executable fenced examples before and after the patch.
Its added API syntax is covered by the exact public declarations, pinned source,
and existing evidence above. No new runtime example, artificial test, or rebuild
is necessary to adjudicate this prose-only change. The quiet-window hold stays
active: no installs, builds, tests, runtime imports, or example children start.

## Static gates and preserved failures

Only scoped Markdown formatting, relative-link/anchor checks, exact-byte checks,
and strict whitespace/diff analysis are performed. They do not run SafeJS or a
test framework. The four publication documents must pass configured formatting
and have no whitespace diagnostics; the final manifest records those results.
No full-repository gate or visual CLI behavior change is introduced.

All four initial author incidents remain in the copied immutable evidence:
the held-manifest field assumption, formatter REPL setup failure before spawn,
the initial author-report table formatting warning, and the own staging path
not being ignored. The author's corrected final bytes are reviewed as supplied;
none of those incidents is erased or mislabelled as a runtime failure.

## F4 independent clarification review and composition

Boyle's read-only data-adjudication manifest is verified at SHA-256
`95aca4507247984d1124dfc31c6bdbcf89d37ad7d9c6bf3ae260e31b763c8acc`.
Its original status records non-isomorphic legacy-dump drift with unchanged
recorded guest witnesses and an open disposition. That original status remains
immutable. This later review verifies selected sealed selector/terminology
evidence and Laplace's completed contract/consumer analysis at SHA-256
`fd4603551d6735037b3dd03cb67bc07fc6b2584ed9d44442124e8e96305ea29d`.
No raw captured graph is traversed or re-executed here. Existing measurements
are attributed to those reports, not represented as new runtime observations.

Per the supplied finding, the tested Map first load/run/dump can change outer
legacy heap and host-call function-marker aliases and names, not merely their
numbering. Tested canonical typed replay graphs, journals, and actual native
guest observations remain exact. These are distinct comparison surfaces: no
whole-dump or legacy-projection byte/graph stability, complete legacy bijection,
or claim that all changed references are unreachable is approved here. The
manifest explicitly records `completeLegacyBijection: false` alongside
`canonicalTypedIdentityBijection: true`; neither field alone settles consumer
impact. Four whole-dump comparisons and two legacy-hostCalls journal comparisons
remain FAIL, separate from the canonical/native observations.

The unchanged contract's statement that later execution cannot mutate bytes
already serialized refers to a retained artifact, not equality of newly emitted
dumps after load/run. Its six-profile O10 comparison and tested completed-Map
identity statements remain bounded to those cases and observations. They do
not resolve this newer F4 finding or expand to universal Map round trips.
Laplace's incremental author manifest is verified at SHA-256
`5bea13fa1a476f2142858d3ee217afc6f45cd23a16ba2be58a3854bbaa83b8cc`;
all seven declared members match hashes and lengths. Its two publication
postimages are independently reviewed without modifying either author's bytes.
Exactly 19 inserted lines add “Canonical replay and outer projections” to the
approved contract, with no removed or otherwise changed approved lines and no
new executable examples. The new author addendum is the fourth unique path.

The static consumer cross-check agrees with the narrowly scoped clarification:

- `host-call.ts:136` checks legacy call identities/lifecycles before selecting
  canonical records; `:485` decodes typed outcomes with registered capabilities.
  `host-bridge.ts:311` delivers those outcomes to replay and `onReplay`.
- `host-call.ts:550` creates unnamed reconstruction placeholders;
  `snapshot/dump-format.ts:92` projects eligible outer data. These markers are
  not the canonical proof/capability identities. `snapshot/validation.ts:139`
  still validates references within each envelope; nothing is declared wholly
  unreachable or irrelevant to every consumer.
- `run.ts:226` selects source replay when canonical history is present. The
  separate legacy-only path is not certified by these modern captures. The
  original identity, callback, and native Map assertions remain unchanged.
- `migrate.ts:46` hashes the entire artifact after canonical key ordering;
  `:97` does not normalize graph references. `snapshot/migration.ts:64` requires
  that exact digest. `MIGRATION.md:33` distinguishes harmless key reordering
  from changed recorded values. A receipt for the earlier artifact cannot be
  transferred to a regenerated dump with changed projection fields. This is a
  static contract conclusion, not a newly executed migration check.

Thus the supplied modern captures establish a bounded representation
qualification, not a confirmed supported replay/proof/identity defect. Actual
legacy marker alias/name loss remains observable to direct JSON consumers; no
universal byte idempotence, whole-state equivalence, external decoder contract,
or legacy-only compatibility is accepted. Laplace's technical adjudication is
complete; release/publication acceptance remains root-owned. O17's separate
native-parity RED and user scope question remain open.

Composition starts at the publisher-reported contract baseline
`b3c62930c236e3f1b1c9f64236c12449a0bdf73b104fcee3e3566eba256108d0`.
This equals this review clone's exact HEAD preimage. The intermediate approved
`925aff82a7bb76e7f48297491923c52f2c3fc60be25926ceab01c54f4814dc9c`
is prerequisite evidence only, not the final patch preimage or a second
publication entry. The final contract is exactly
`208d2d29405f9484be73a9d4baabe5bbff93a80a77f94c0f2fa2fd0cc2f0c64b`.
All three plan preimages are absent in this review HEAD and are reported absent
by root for the publisher. No publisher workspace is read; publication must
recheck those identities. The old three-file group was not integrated and does
not need to be reverted.

The earlier sealed review manifest remains unchanged at SHA-256
`fbe5cf06e1b99aa767ae5f82d472d4a169bf65bf3d44fc11c11103ed96cca794`.
The later three-file qualified capsule also remains unchanged at SHA-256
`5bf03490eae48d14ec76a68190073d0b23ac959bab671f6f6907cf48948b9fc0`.
Both historical postimages and all initial failures remain preserved. The
incremental author's metadata-only draft-string syntax error, which executed
no code and wrote no file, remains in its captured static-validation receipt.

## Exact publication and exclusions

The final publication list contains exactly:

1. `packages/safejs/CHECKPOINT_REPLAY.md` — Laplace's exact final postimage,
   incorporating Nash's unchanged prior content, and the exact publisher-baseline
   preimage rather than the intermediate approved document.
2. `docs/plans/safejs-contract-docs-final-author.md` — Nash's unchanged report;
   main preimage absent.
3. `docs/plans/safejs-contract-docs-final-independent-review.md` — this review;
   main preimage absent.
4. `docs/plans/safejs-f4-map-projection-doc-clarification.md` — Laplace's unchanged
   incremental author addendum; main preimage absent.

Prerequisite manifests, source/type evidence, compatibility qualifications, and
validation logs remain separate from publication. README/template proposals,
actual README/skill files, installed copies, sync, source/test/configuration
changes, and O17 feature work are excluded. Both authors' incremental patches
are preserved as prerequisites. The final patch contains exactly four unique
publication paths; evidence and intermediate postimages are not publication.

The standalone review manifest is under
`out/safejs-contract-docs-independent/dist/final-four-doc-composition/manifest.json` in
this clone.
Root still owns publication and fresh publisher preimage checks. No commit,
push, README edit, source edit, original audit payload read, or other-clone write
is performed. The independent verdict does not release the quiet-window hold.
