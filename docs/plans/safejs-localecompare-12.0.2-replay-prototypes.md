# Released 12.0.2 replay prototypes: author disposition and repair

> V6 is corrected on current main; publication is NOTREADY on four O12 cases.
> See the final revised section; previous failures and capsules stay historical.

## First focused handoff

A genuine supported-language replay defect is confirmed in the retained
`poe-code@12.0.2` artifact. It is separate from the original observer failure:
ordinary host records lose `Object.prototype` when journal outcomes are cloned.
That loss changes the result of `String(await ack())` after a completed checkpoint
is restored. No prototype-normalization waiver can close this semantic failure.

This capsule contains a minimal source repair and fast TDD regression, ready for
independent review, not publication approval. The original two fresh REDs,
partial outputs, secondary observer errors, and all earlier capsules remain
immutable. No README, SKILL, master ledger, version marker, or original guest
source was edited. No commits, pushes, original archive reads or security probes.

## Release and evidence identity

Noether's retained failure manifest:
`/Users/kjopek/Workspace/poe-code-safejs-localecompare-independent/out/safejs-remediation/localecompare-12.0.2-independent/candidate-20260830-eccffd2f-not-ready/manifest.json`

SHA-256: `546e0f0e3d239a5b5a9537ab83dcd24c27c8f753e6e8e026464bb51f15372b8e`.
Target gitHead: `eccffd2fa82e9c0540a37a48d70e494ca93b1886`.
Retained tar SHA-256:
`51dcfddfb5b41b975ff5048723ab401a5298693423f9df14d568269542ee6676`.

Only manifest-allowlisted copied evidence was read, with canonical containment,
byte-count and SHA checks. The tar was installed in this author's owned temporary
installation. The approved dependency lock was reused, changing only its two
local tar references; lifecycle scripts ran normally with an isolated temporary
HOME/cache and no shared writable modules. No package was refetched as latest.

All 3,351 installed package files match the tar. The owned module tree contains
another 9,506 files and 19 symlinks: 12,857 total files, 12,876 entries including
symlinks, matching the prior count's scope. Every captured package/dependency
byte and symlink was rechecked unchanged after the controls. Runtime is Node
22.22.2. This is specific to the retained 12.0.2 artifact, not later main or Float.

The candidate source workspace remains at
`e6b70989225781249f2cf395b927186894fad7c2` plus the earlier frozen locale delta.
The relevant released values/host-journal code is pinned separately from the
installed artifact. Other intervening source changes are not overlaid. A future
publisher must apply this one-hunk repair to the actual integrated source and
review any Float overlap; copying this older complete values file blindly is
not authorized.

## What the original observer actually did

The original fresh `work.pause` replay hook compares a captured graph of the
recorded outcome against a newly constructed ordinary host acknowledgement.
At the first difference it throws `Acknowledgement replay mismatch`.
`declareHostOperation` correctly turns a throwing replay hook into a reset
failure. Later observer code dereferences the absent return value and produces
a secondary error. Both failures and their partial 19-draw / clock-1001 outputs
are preserved, not relabeled successful.

The serialized journal already says `nullPrototype: true` for each of the
three acknowledgement records. The decoder faithfully restores that flag; it
is not independently inventing a new prototype. A hook comparing canonical
recorded data to an unconverted raw host object therefore uses the wrong
representation domain for that comparison. This does not establish that the
earlier producer-to-journal prototype loss is semantically harmless.

## Authoritative contract and causal path

The exact `packages/safejs/CHECKPOINT_REPLAY.md` SHA-256 is
`208d2d29405f9484be73a9d4baabe5bbff93a80a77f94c0f2fa2fd0cc2f0c64b`.
Its raw-view section distinguishes shallow diagnostics from serialized bytes
and explicitly does not relax persisted-checkpoint correctness. Lines 55-63
make canonical typed replay authoritative over outer projections. Lines 154-162
say `onReplay` receives the recorded outcome and that throwing aborts replay.
These clauses justify decoding the recorded flag. They do not promise that
changing a supported String result is harmless, nor license prototype grafting.

The retained installed source-equivalent build establishes the cause:

1. The host bridge copies an ordinary host result while preserving its ordinary
   prototype and returns that value to initial execution.
2. Journal retention calls `copyOutcome`, which calls `cloneSandboxValue`.
3. That clone enters `copyToSandbox` with its existing clone-mode flag enabled,
   but the record branch still unconditionally creates a null-prototype object.
4. The typed replay encoder accurately records the already-lost prototype as
   `nullPrototype: true`. Its decoder later honors the recorded flag.
5. The existing String intrinsic invokes native coercion on the replayed value.
   The changed prototype can therefore change a supported guest expression.

Exact installed file hashes, line excerpts and the pinned contract sections
are in `evidence/released-code-and-contract.json`. No private runtime adapter
or patched installed bundle is used.

## Confirmed semantic RED

Minimal unchanged control source:

`const value = await ack(); return String(value);`

The finite async host operation returns `{ label: "ack", accepted: true }`.
Native and the installed producer both return `"[object Object]"`. Public
`dump(execution)`, followed by public restore in a separate child, yields:

- Rejection: `TypeError: Cannot convert object to primitive value`.
- Stack: `at String (line 1, column 35)`.
- New host calls: zero.

This happens with a nonthrowing observation hook and again with **no replay
hook at all**. Thus it is not caused by Noether's observer, a fabricated proof,
a callback invocation, or an external side effect. Initial semantic controls
preceded the first new native control; a second native control was run before
the final no-hook producer/fresh pair. That ordering is recorded, not rewritten.

A genuine null-prototype host record remains null in both producer and fresh
installed controls. Native coercion of a genuinely null-prototype object must
not be repaired by grafting `Object.prototype` onto it.

## Full original workflow diagnostic

Two new author diagnostic executions retain the original guest source, inputs,
producer captures, shared LCG/time/UUID stream, all predicates, and 12,000 ms /
256 MiB / 16 MiB caps. Only the acknowledgement observer's throw is recorded as
mismatch data instead of aborting. These are explicitly new diagnostics, not
replacement passes for the original fresh REDs.

Both reach public completion with the same full return values, 54 RNG draws,
clock 1006 and ten existing value checks. Each has 15 replay hook events and
zero new host calls. Every call ID, run ID, operation/module, argument digest,
policy, lifecycle and the entire canonical replay journal remain exactly equal
to the retained producer journal. These cases contain no recorded callbacks.
The error graph is exactly undefined. Full local hook journals match native;
no shortened event prefix is accepted.

Each returned typed graph retains 23 nodes, every own key, descriptor flag,
extensibility flag, array length, primitive value and reference edge. The only
producer-versus-fresh graph changes are acknowledgement node prototypes 15, 19
and 22: ordinary to null. They exactly match the recorded canonical flags.
Guest records are not modified. All three original hook predicate mismatches
are retained per seed, even though the nonaborting diagnostic completes.

A separate canonical-domain observer could validate this exact recorded data,
with prototype flags taken from the immutable outcome and strict all-field /
reference checking. It must not compare all outputs after blanket conversion.
Such an observer is insufficient to close the newly demonstrated String bug.

## Minimal repair and TDD

The only production change is in
`packages/safejs/src/interp/values.ts`, the ordinary-record allocation inside
`copyToSandbox`. Clone mode now preserves an already accepted record's existing
ordinary-or-null prototype. Input conversion still creates null-prototype
records, since its clone-mode flag is false. Supported input kinds, own-data
copy rules, function guards, budget/depth checks and error branding are unchanged.
No arbitrary native prototype, constructor, getter or native callable is enabled.
The same clone helper is also used by the existing structuredClone intrinsic;
its targeted tests are included.

Preimage SHA-256:
`cb26ac566eaed9ade10ff5bafdd5454104bae2b62b8f76792dc4f4936313ced5`.
Postimage SHA-256:
`2a03bb66157742d5c3aa6ea8b0b20725b8a71599398f65615762c9786b37b320`.

New proper package regression:
`packages/safejs/src/host-result-prototype-replay.test.ts`.
It uses public run/dump/restore, inline finite mocks and no file writes.
Before repair: one semantic failure and one genuine-null negative passed.
After repair: both pass unchanged. A scoped nine-file run passes 143 tests,
including existing values, host-call, host-bridge, host graph, structuredClone,
typed replay, completed replay and failure replay coverage. No full unit gate.

A fresh standard SafeJS package build completed at 2026-08-30T05:43:54Z.
Configured root types, owned regression types and scoped ESLint pass. Separate
source and standard-public-built children now produce and freshly restore the
native String result with zero reissued host calls. This package build is not
a fresh full-root CLI bundle or a new installed release.

## Old captures and integration limits

The source repair preserves information in **new** journal captures. It cannot
recover a lost ordinary prototype from an old capture that records null, because
a genuinely null-prototype result has the same recorded flag. Both patched
source and patched public-built controls still reject the unchanged old 12.0.2
String capture with the original TypeError and zero host calls. This is an
explicit old-loss negative, not a promised repair of old capture semantics.
No version marker, old outcome, source text or reference is rewritten.

Independent review must distinguish:

1. Faithful canonical decoding of the original O15 captures, whose original
   strict raw-host observer remains RED and is preserved.
2. The real producer-to-journal semantic loss demonstrated in 12.0.2.
3. The minimal new-capture source repair, not yet reviewed on actual integrated
   main and not yet released.

This candidate contains exactly three publication paths: values, the new test,
and this report. The earlier locale source/test/report are prerequisites, not
new publication deltas. Pending Float work may also touch values; coordinate
exact preimages and apply the one-hunk patch rather than replacing that file.
A different independent reviewer and the publisher's actual-main gates are
required. No all-stack, older-capture, universal prototype, Error, or security
compatibility guarantee is made.

## Preserved author setup failures

The first install used the same /dev/null path for both npm user and global
config, which npm rejected before installing. Separate owned config files fixed
setup; the failure log remains. An initial Node REPL call referenced unavailable
process state before child execution; it was replaced with explicit env argv.
No deadline was extended, no runtime failure was converted into a pass, and no
original archive or another worker's writable installation was used.

## Current-main Float integration: 2026-08-30

### Decision: NOTREADY for publication

The exact reviewed five-path change is integrated onto fresh pulled main
`dd7f0fcd0d7796ee17577af2a7d76da295cc5a70`, including Float commit
`b16e7eeb20cdf56d726267de2b5fa5d356157278` and the intervening SAFEFS changes.
The previous independent READY applies to its older composition, not this one.
The current SafeJS source gate has **3 failed, 8,615 passed, 34 skipped** tests
across 206 files (1 failed, 204 passed, 1 skipped). No assertion is changed,
excluded, waived, or relabeled successful.

The blocker is `packages/safejs/src/run.promise-compatibility.test.ts:40`:
`data/saved`, `guest/saved`, and `host/saved` expect the historical completed
v6 journal. Each differs at exactly one freshly reissued boundary result:

- data and guest: `/replay/calls/0/outcome/data/nodes/0/nullPrototype`;
- host: `/replay/calls/1/outcome/data/nodes/0/nullPrototype`;
- expected `true`, actual `false`.

A bounded public-source diagnostic covers all six saved/completed cases and two
subsequent restores of each. The saved cases reissue only `boundary("before")`;
its current host function creates a new ordinary record. No readValue/provider
call occurs. All six return value 7, retain jobs-v6, and leave input bytes intact.
All three already-completed histories match their entire expected selected
snapshot fields. Both subsequent replays for every case return 7 with no host
calls. Thus the observed mismatch concerns the encoding of **new** ordinary host
results while continuing v6, not a graft onto old stored null records. This
narrows the failure; it does not authorize weakening the compatibility oracle.

Required next disposition: have the compatibility owner and independent reviewer
resolve whether v6 continuation must retain its historical newly completed
outcome encoding. If so, repair that version-aware boundary separately without
reverting ordinary-record clone preservation, altering Float provenance, grafting
old lossy captures, or changing assertions. This author has applied no speculative
additional production change. The exact requested candidate remains held.

### Exact integration and authorship

Prior reviewed manifest:
`89b6daefd3156d33d9730e469ffdb737362fc6ed5e8236d1c8c84f2de0b10c7f`.
Current values preimage:
`6de1b3c67dc4975cf86e260e67c389a6504fee41cf650754b66cbde1b2b323e9`
(28,598 bytes). Current postimage:
`539918a0e83b187784c0aa2b5773610b4e82928517c4fa2bd87d4feed2e296af`
(28,671 bytes). Reversing only the reviewed plain-record hunk reproduces the
entire current preimage byte-for-byte. No old whole values file was overlaid.

The Nash two-test file and Noether four-test file retain their reviewed bytes.
Noether's independent report also remains byte-identical and is included as
provenance, not edited into a new approval. Only this author report is refreshed.
The existing Float typed clone/node provenance, ErrorString, locale, SAFEFS,
root package/lock/bundle source, README, SKILL, and master ledger are unchanged.
No unreviewed String ordinary helper is present in this delta.

### Fresh evidence and exact scope

Evidence root relative to this clone:
`out/safejs-remediation/replay-prototype-integration/dist`.

- Current-main TDD RED: 2 failed / 4 passed before the one-hunk change. GREEN:
  36 passed / 4 files, including the unchanged Float intrinsic and camera tests.
- O15: all 10 native/source/public-built producer/fresh executions pass. The
  original source and independent observer programs are unchanged. Each seed
  retains all 10 anchors, 54 RNG draws and clock 1006; full native values,
  ordered host events, RNG stream and typed graphs match. Return graphs retain
  23 nodes: 16 null-prototype guest records, 3 ordinary host records, 4 arrays.
  Four current-capture fresh restores issue zero host calls and replay all 15
  events with exact full canonical journals and hook graphs. The separately
  approved expected finalAttempts-domain observer is unchanged; the original
  literal observer's false result remains recorded, not rewritten.
- Float original cameras: 15 executions pass: 3 native, 3 source, 3 public-built,
  6 fresh public-built restores, using source- and built-origin captures. Full
  values and traces match native exactly at 111 / 100 / 89 entries.
- Float typed graphs: 7 executions pass: native, source and public-built
  producers, then pending/completed fresh public-built restores of both origins.
  Typed bytes, shared buffers, owner/raw cycles, Map/Set edges, metadata,
  callback observation and caller bytes match native. Completed canonical
  journals, actual request IDs and source callback ID 1 survive exactly.
  Fresh exchange host calls are zero; pending checkpoint reissue is one,
  completed checkpoint reissue is zero. Labels containing fresh-source mean
  source-origin capture, **not** a source-module fresh consumer.
- Ordinary and genuine-null record controls pass for both current producers
  and four fresh restores of their actual new captures. Both unchanged old-lossy
  capture controls still reject with TypeError and zero host calls. Four earlier
  supplemental fresh attempts consumed historical good captures because this
  author's wrapper selected by the wrong metadata field. Those complete outputs
  are retained separately and are not counted as current-capture proof.
- Full SafeJS source regressions include Error/error-channel and host-callback
  controls. The gate is nevertheless FAILED by the three v6 assertions above.
- Fresh forced standard root build: **68/68 successful, 0 cached**; completed
  2026-08-30T06:10:39Z. Current SAFEFS/workspace composition has 68 build tasks;
  this is the actual count, not an inherited older count.
- Configured `npm run lint` passes ESLint, build-configured types and actionlint.
  Owned regression TypeScript compilation reports zero diagnostics. Scoped
  five-path formatting and strict patch whitespace checks are recorded in the
  final manifest. No root-wide unit or root-wide format pass is claimed.

All new install/build/test/runtime wrappers explicitly set owned HOME, npm cache,
TMPDIR and XDG paths, unset TERM, and set SKIP_SYNC_SKILLS=1/HUSKY=0. No live sync
runs. The older independent report's inherited-HOME/cache uncertainty is preserved
and **not retroactively cleared** by these new executions. Inputs come only from
hash-verified, canonically contained copied-capsule allowlists and current
package-local fixtures; no original archive was read.

Author observer mistakes are retained in adjudication-attempt evidence: an
already decoded stdin was mistakenly JSON-parsed; clock/error field shapes were
initially read incorrectly; native-only camera records were initially tested for
a public API envelope. Corrected adjudication reads the actual receipt schema,
without rerunning, altering, or normalizing the guest results/native oracle.

No commit, push, release, other-clone write, source/version rewrite, or independent
self-approval is included. The sealed manifest is a reproducible **NOTREADY**
author integration handoff, not authorization to publish through a failing gate.

## Revised current-main integration after accepted V6 disposition

### Final author status: V6 corrected; publication NOTREADY on O12

Fresh clone and pull select main `860467821d390fab7da8095de9f7fec8b43055de`.
This preserves the external SAFEFS SDK/CLI/index/package-lock changes. No pending
Map mutation release or unreviewed ordinary-String helper is overlaid. The
publisher must check every declared preimage against its actual later main; this
is not permission to overwrite a newer complete values file.

The accepted independent V6 disposition is manifest
`bd07a5816c5f2c4466612859df51c2c72bc894fedb894130ac84b5f8540c20a7`.
Its exact report is included unchanged at
`docs/plans/safejs-v6-reissued-outcome-disposition.md`, SHA256
`13656fa5b469030fec4c21f5f3a4f9d7e904c8f7adb8469fb874d45337a2a924`.
It approves the bounded oracle disposition, not this new integrated candidate.
No independent reviewer report or test was edited.

The source change remains the same single plain-record clone hunk. Values
preimage SHA256 is
`6de1b3c67dc4975cf86e260e67c389a6504fee41cf650754b66cbde1b2b323e9`
(28,598 bytes); postimage is
`539918a0e83b187784c0aa2b5773610b4e82928517c4fa2bd87d4feed2e296af`
(28,671 bytes). Removing only that hunk restores the complete current preimage.
There is no V6-specific lossy-clone production mode.

### Bounded V6 expectation correction

Only `packages/safejs/src/run.promise-compatibility.test.ts` receives the
additional authorized test change. Each saved case identifies its exact running
boundary by saved call ID, requires re-issue policy and absence of an outcome,
and constructs a complete new expected outcome from the fixed native host
literal and existing canonical schema. The new ordinary record explicitly has
nullPrototype:false. The expectation never invokes the changed clone/codec and
never derives its value from an actual result or normalizes actual graphs.
Every other completed-row field and historical prefix remains untouched.

The test compares the entire canonical journal with toStrictEqual, also checks
initialInputs and promiseReplay exactly, keeps version1/jobs-v6 and original
return/effect assertions, and checks full journals on both no-effect subsequent
restores. The consumed readValue prefix retains its true null flag. Native host
stub prototypes are checked directly. Genuine-null variants exercise all six
saved/completed cases; completed histories invoke neither replacement shape.
Original migration, source-mismatch, failure, and unsupported-marker cases stay.

The actual fixture remains 81,409 bytes, SHA256
`c2b3bf03855bcb99f91e1182632edaa91965036254a4305c993a4c4aa0b30a6e`.
Both input and historical-completed objects are checked unchanged after every
case. Separate finite expected-schema comparator controls reject 22 mutations
across the three fixtures: values, missing/extra fields, references, prototype,
call ID, channel, and an old-prefix graft. These are metadata comparator checks,
not additional SafeJS executions.

Fresh TDD evidence: unmodified current production yields 2 failed / 4 passed
prototype tests. Applying only the production hunk reproduces the authorized
3 failed / 11 passed compatibility REDs. The corrected compatibility file has
20 passing tests; together with the six unchanged prototype regressions the
final focused result is **26/26**. An initial owned TypeScript diagnostic from
accessing the JSON fixture's inferred optional outcome was preserved and fixed
with a property matcher; exact whole-prefix equality remains. Final owned
three-file type compilation has zero diagnostics.

### New full-gate blocker: four O12 cases

The **full default root** command is npm test, not a filtered source selection.
The final current-byte run finishes 2026-08-30T06:57:08Z with **26,505 passed,
4 failed, 41 skipped**, across 1,030 files (1 failed, 1,026 passed, 3 skipped).
All four failures are unchanged assertions in
`packages/safejs/test/integration/input-error-projection.test.ts`, SHA256
`1d84134fbed72fb7be6eabbab331d22d59ab3641cf05966b29b826e9a92a61e4`:

- complete proofs 1/2 at line444: whole resumed versus captured replay journals
  differ at three ordinary fulfilled-batch/event record prototype bits;
- minimal proofs 1/2 at line384: the two-field name/message encoded reason has
  nullPrototype:false rather than expected true.

The full SafeJS package default also runs both src and test directories:
**8,878 passed, 4 failed, 39 skipped**, 226 files. Its four failures are the same
O12 cases. The initial root run had 26,504 passes and five failures; its additional
agent-eval child-runner failure is separately preserved. The final root run does
not silently subtract it: it actually passes after the owned temporary directory
is moved outside the repository, with source/tests/config/deadlines unchanged.

The V6 authorization is not an O12 oracle waiver. No O12 file, proof converter,
production boundary, or expected prototype is changed. Route these exact cases
to the O12 owner and an independent reviewer to distinguish initial-input
normalization from new proof/outcome encoding using whole typed graphs and
journals. A lossy clone or weakened proof guard is not an acceptable workaround.
The candidate remains NOTREADY for publication until that separate finding and
independent integration review are resolved.

### Current source, built and fresh graph checks

- All 10 original O15 executions pass: native seeds123/42, public source-index
  and public-built producers, then current-capture fresh restores of each.
  Full native values, every typed graph field, RNG stream and ordered journals
  match the unchanged approved oracle. Each has 10 anchors, 54 draws and clock 1006. Fresh restores issue zero host calls and replay all 15 hook events.
- All 15 original Float camera controls pass: three native, three original
  core-source, three public-built, six public-built fresh restores. Full native
  traces remain exactly 111 / 100 / 89 entries.
- Six additional camera controls cover the new current public source index and
  its dump export directly: three producers and three fresh public-built
  restores. Only the host adapter import/export selection changes; original
  guest source, fixtures, bounds and full expected values do not. All pass.
- Seven typed graph controls pass: native/source-index/built producers and four
  pending/completed fresh built restores. Complete values, bytes, buffer sharing,
  aliases/cycles, metadata, Map/Set edges, callback observations, actual request
  and callback IDs, and entire completed canonical journals remain exact.
- Ten ordinary/null/lossy controls run anew. All four fresh controls use their
  actual new producer captures. Both unchanged old-lossy captures still reject
  with TypeError and zero host calls. No prototype graft or history repair occurs.

All original O15 bounds remain 12,000 ms / 256 MiB / 16 MiB. Original Float
bounds and native-first order are retained. Fresh-source labels in original
Float receipts identify source-origin captures, not source-module consumers.
The extra current-index cohort is explicitly separate rather than relabeling
those original core-source observations.

### Separate Float raw-record observer disposition

The exact additional released-Float capsule is
`f8a221f384471e4fb4bd83504a0de506e7926169e78b1ee41f621fd243a2dc46`.
Its failing source is unchanged:

`try { new Float32Array(-1); } catch (error) { return {ok:false,name:error.name}; }`

The failing strict host assertion compares this **guest object literal** to an
ordinary native host record. It contains no host operation or recorded host
outcome and does not return the caught Error object. On this candidate, the
native assertion passes and both public source/built literal assertions still
fail; those new REDs and their original released predecessors remain intact.
This is not the O15 ordinary-host-outcome clone-loss mechanism.

Existing public RunResult exposes InterpreterResult/SandboxValue, and the
unchanged object-literal evaluator at interpreter.ts:556 constructs a null
record. Existing value-conversion tests also explicitly retain null records.
The new hunk preserves that existing null prototype. The raw-snapshot shallow
view documentation is **not** used as a blanket justification for this result.

A separate proposed raw-guest-domain observer uses a manually specified complete
record graph: null prototype; exactly ok/name keys; false/RangeError values;
all three own-data flags true; extensible true. Source and built producers and
both current-capture fresh restores match it, with empty canonical host journals
and zero host calls. Five counterexamples per observation reject a prototype
graft, missing/extra key, changed name, and changed descriptor. Actuals are not
converted or normalized. Native Object.prototype remains separately recorded.

This bounded author disposition is **pending independent review**, not closure
of every raw prototype assertion. It provides no universal native-prototype,
String({}), alias or error-stack guarantee. This exact record has only primitive
fields; it exposes no nontrivial alias or Error identity to assert. The API
fulfills ok:true while the guest value contains ok:false. No current npm artifact
or new release validation is claimed.

### Static gates, isolation and handoff

Fresh standard forced root build succeeds **68/68**, zero cached tasks, finishing
2026-08-30T06:40:42Z. Configured ESLint/types/workflow lint and owned types pass;
final seven-path formatting, strict whitespace and patch checks are captured
with exact command receipts. Current index, SAFEFS package/lock and 52 protected
paths are pinned unchanged; all 271 built SafeJS files and root bundles are hashed.
No README, SKILL, ledger, other clone, old capsule, or Git publication is modified.

Every install/build/test/runtime wrapper has explicit owned HOME/npm cache/XDG
paths and unsets TERM. SKIP_SYNC_SKILLS=1 prevents live sync. The first default
root run used an owned TMPDIR inside the repository and reproduced the nested
agent-eval fixture failure even in isolation. Moving only TMP/TEMP/TMPDIR to an
owned external directory makes that focused test and the final full-root case
pass. Config discovery through repository ancestors is consistent with the
runner and root include patterns; its child configuration was not instrumented.
No timeout or test exclusion changes. Older Noether HOME/cache uncertainty stays
historically qualified; new wrapper controls do not retroactively clear it.

Evidence root: `out/safejs-remediation/replay-prototype-v6-integration/dist`.
The exact seven publication paths comprise four author-owned files and three
unchanged independent prerequisites. Final manifest includes current preimages,
postimages, full patch, commands, failed attempts and source/artifact identities.
No standalone executable QA file is introduced. Large evidence capture initially
hit the author's argv-based patch wrapper; the preserved completed outputs were
captured via apply_patch stdin without rerunning or changing their outcomes.

## O12 adapter preparation during the publisher CPU hold

August 30, 2026. **Prepared, not executed or approved.** The source workspace
remains based on `860467821d390fab7da8095de9f7fec8b43055de`. Root authorized the
test-only recipe in Noether's read-only report:
`/Users/kjopek/Workspace/poe-code-safejs-replay-prototype-independent/docs/plans/safejs-o12-proof-provenance-disposition.md`.
I read the full report and found no provenance disagreement with its bounded
recipe. This is not a finding that all host and sandbox prototypes are equivalent.

The original capture supplies the deferred left input through the public
`deepCopyToSandbox` input boundary. The prior restore adapter supplied its native
ordinary outcome without that conversion. The pending-call proof supplies new
data; no saved outcome is being rewritten. The adapter now explicitly converts
only the fulfilled left proof input through that same public boundary. The right
complete, minimal and native-fields receipt branches remain separate and retain
their existing identity and metadata assertions. Actual outputs, snapshots,
encoded outcomes, fixtures and entire proof objects are never normalized.

Only the minimal reason's explicit expected prototype flag changes to `false`.
The complete whole-journal equality stays intact. The minimal whole-journal
expectation still removes exactly Error branding and stack, with all other
fields, references, metadata and order compared. No production, codec, generic
function guard or source-function context change accompanies this correction.

Two separately named controls are prepared alongside the unchanged eight cases:

- `preserves raw-left proof provenance with the complete right receipt` submits
  the native left data without conversion. Its expected whole journal differs
  from the original modeled-input journal only at the three independently
  identified left record nodes, whose prototype flags must be `false`. It must
  not compare equal to the original journal. Expected data comes from the
  original captured journal, not the resumed actual.
- `preserves genuine-null-left proof provenance with the complete right receipt`
  supplies newly constructed genuinely null-prototype data records, not records
  changed with a prototype graft. The event array remains an ordinary array;
  this control retains complete original-journal equality.

The adapter records native, captured and supplied left provenance before V8
transport can discard prototype distinctions. Assertions cover the entire
fixture value, own keys, all descriptors, extensibility, exact prototype kinds,
array identity, record/descriptor reference edges and distinct event records.
The original native receipt is checked for byte-equivalent V8 serialization
before and after execution. Existing complete Error aliases, exact stack,
minimal no-brand/no-stack/identity-loss negatives, request/call/digest checks,
zero callback counts, full traces/acknowledgements and completed no-effect replay
assertions remain. The original source and fixture files are unchanged.

TDD uses the retained four RED observations and the retained pre-edit test:
`out/safejs-remediation/replay-prototype-v6-integration/dist/evidence/o12-adapter-hold/preimage.test.ts.txt`.
The failure pointers remain `evidence/new-O12-blocker.json`,
`evidence/full-default-final.log` and `evidence/safejs-default-tests.log` under
the same evidence root. No historical failure, seven-path patch, captured
postimage, old lossy fixture or accepted V6 disposition is replaced. The new
working scope is eight publication paths: the prior seven plus
`packages/safejs/test/integration/input-error-projection.test.ts`. Noether's
read-only report remains an external review reference, not an edited or newly
self-approved publication file.

After an explicit CPU resource handshake, run the source and standard-built O12
selections first, retaining all ten test cases' observations and their completed follow-ups.
Use owned HOME/cache/TMP/XDG paths, `env -u TERM` and `SKIP_SYNC_SKILLS=1` in every
wrapper. The existing child deadlines and sandbox budget remain unchanged. Stop
on any disagreement; do not change expectations to fit actuals. Independent
typed-graph review must precede renewed default package/root gates. Existing
O15/Float constraints, current-index composition, V6 controls and the one-hunk
production scope remain binding. Formatting, compiler checks, build, runtime,
bulk hashing and sealing are all deferred; no new GREEN or readiness claim is
made by this preparation.

## Current Map-main integration and executed O12 correction

August 30, 2026. New owned workspace:
`/Users/kjopek/Workspace/poe-code-safejs-replay-prototype-o12-current`.
Clone and `git pull --ff-only` pin
`0750017f6fa71054a4b5cf6e4961139a01788b9d`, including the intervening
`8bdd30a7c804e646fdf2c569bc6bdabd408f301c` documentation and Map/Set mutation
release source. The previous workspace, failed gates and candidate captures are
unchanged. This is an author handoff for fresh Noether review, not publication
approval or a new released-artifact verdict.

### Exact scope and integration

The eight-path publication draft contains the same one-hunk `values.ts` fix,
original author regression, author report, three unchanged independent
prerequisites, the accepted V6 expectation correction, and the O12 test adapter.
All three tracked-file preimages equal current main. No whole old `values.ts`
overwrite was used. Map/Set production slices, Float typed cloning/provenance,
Error/String support, current filesystem SDK/index/CLI composition, package and
lock files, README, SKILL and ledger remain untouched. The final manifest pins
current base preimages, actual postimages and the exact combined patch.

The O12 public input conversion occurs only on the supplied left fulfilled
proof input. The complete Error is recovered through the existing public receipt
path; no raw native Error, forged brand, function cast, private converter,
blanket output normalization or version-marker rewrite is introduced. The
genuine-null control constructs new null records; it does not graft a prototype
onto an existing result. Original guest sources and fixture bytes are unchanged.

### Executed finite gates

- Fresh standard build: **68 successful / 68 total, zero cached**, including
  current FS and Map source. It starts at `2026-08-30T07:42:23.619Z` and completes
  at `2026-08-30T07:42:44.163Z`. No second full build is needed for test formatting.
- O12: **10 source and 10 standard-built tests pass**, with 36 retained typed
  child observations. All 16 completed follow-ups run and make zero host calls
  and zero proof requests. Complete modeled and genuine-null journals are exact;
  minimal journals lose exactly branding and stack. Raw-left journals differ
  only at the three specified ordinary record prototype flags. Five-row journals,
  native values, descriptors, reference edges, request identities, zero callback
  counts, acknowledgements and input/receipt immutability are retained.
- Focused V6/prototype/Float/Map selection: **104 tests pass**. This includes all
  20 compatibility cases, six prototype regressions, 30 Float tests and 48
  upstream Map/Set tests. No historical fixture or old lossy negative changes.
- O15: **10 bounded executions**, two native seeds plus source/built producers
  and fresh resumes. All ten anchors, 54 RNG draws, clock 1006, complete values,
  typed observations and canonical journals match the retained oracles. Fresh
  executions make zero new host calls and expose all 15 exact replayed events.
  Native host events are compared to replayed events, not incorrectly required
  to execute again. The original literal producer observer failure remains
  separately visible; the previously approved expected-domain observer is not
  substituted into the original source or native recipe.
- Float originals: **15 executions** through native, current public source
  index, standard built and fresh built APIs, with exact full traces
  **111 / 100 / 89**. Seven further typed graph executions preserve complete
  native bytes, metadata, aliases, cycles, Map/Set edges and callbacks, including
  current pending/completed fresh replay journals. Redundant prior core-only
  executions remain historical, not relabeled as current-index checks.
- Ordinary/null/old-lossy controls: **10 completed executions** preserve
  ordinary `String(value)` behavior and genuine-null identity/provenance.
  Unchanged old lossy captures still reject with the original TypeError and
  zero new calls. One author invocation first supplied JSON dump text instead
  of the documented parsed snapshot object; that failed attempt is retained
  separately. Only that input binding was corrected, without a cap increase.
- SafeJS default package selection: **8,932 passed / 39 skipped**, 228 files
  (227 passed, one skipped), no failures. Root default selection: **26,559 passed
  / 41 skipped**, 1,032 files (1,029 passed, three skipped), no failures and
  Turbo **one successful task / one total, zero cached**. Both run once,
  sequentially, with unchanged worker settings and timeouts. The root count is
  publisher Map-main's 26,545 plus six prototype tests, six additional V6
  ordinary/null cases and two O12 controls; it is not unexplained coverage.

The O12 test receives formatting only after its focused built run. Its inline
child program is byte-identical before/after formatting; the final formatted
file participates in both default suites. The old four O12 REDs are retained
as full raw logs alongside the independently authorized provenance correction.
They are not silently waived or relabeled as historical patch warnings.

### Float raw observer and evidence qualifications

The exact additional Float control still returns a guest-created two-field
record. Its native literal comparator passes natively and remains RED in source
and built modes. The separate proposed raw-guest-domain observer passes four
producer/fresh checks with the complete null-prototype descriptor graph, five
negative comparisons each, empty journals and zero host calls. This is not the
O15 host-outcome clone defect and is not a universal prototype waiver. The
bounded disposition remains explicitly subject to independent review.

All wrappers use owned HOME/npm cache/XDG directories and an outside-checkout
TMP directory, `env -u TERM`, and `SKIP_SYNC_SKILLS=1`. No live skill sync,
original archive reads, provider/LLM calls, shared writable dependencies, new
standalone QA scripts, commits or pushes occur. Earlier HOME uncertainty is not
retroactively cleared. No CLI presentation change is made or screenshot result
claimed by this package-level integration.

A 10-second evidence-copy tool timeout reset the command-owner REPL while the
root suite continued normally. No running child was killed or restarted. The
root log finishes at `2026-08-30T07:54:45.789Z` with the complete Vitest and Turbo
success summaries; process disappearance is separately recorded. The exact
parent exit status was not reaped and is not invented. Missing exact end times
for earlier completed command receipts are labeled as log-write timestamps.
Small author metadata-checker errors are also retained; correcting cross-realm
empty-array checks and locating declared capture fields did not rerun or alter
runtime outputs. A formatting precheck warning is retained separately from the
subsequent formatter correction.

Current evidence root:
`out/safejs-remediation/replay-prototype-o12-current/candidate`.
Its command receipts, full raw outputs, typed graph adjudications, historical
REDs, copied read-only Noether disposition, identity pins and final gate results
are the handoff evidence. Independent Noether integration review and publisher
current-preimage checks remain necessary before publication.

## Canonical package rename integration — August 30, 2026

This is a new author integration, not an independent approval or a new release.
The preceding sections remain historical evidence. The isolated clone

authoring this addendum is

`/Users/kjopek/Workspace/poe-code-safe-js-replay-prototype-rename-integrated`.
Clone and fast-forward pull pinned main at
`0b10f2f4d4ccda5577b87ee72bdb85a2fa992558` before integration. The publisher's
unpublished commit and all earlier capsules were untouched.

### Exact eight-path composition

The authenticated predecessor is
`replay-prototype-o12-current/candidate-final/manifest.json`, SHA-256
`0dd995f14f19a8b48d2990b1b679743a2ca2cb01d3a028920dfd664d8ce760ca`.
Each package path maps from `packages/safejs` to `packages/safe-js`.
There is still one production hunk, in `src/interp/values.ts`: preserve the
ordinary/null record distinction when cloning sandbox collections. Its postimage
remains `539918a0e83b187784c0aa2b5773610b4e82928517c4fa2bd87d4feed2e296af`.
It is applied against current bytes, never by overwriting an old whole file.
Float typed-clone provenance, Map mutation handling, Error stringification,
locale comparison, current filesystem modules, package metadata and bundler
configuration remain upstream-owned and unchanged.

The V6 pending-outcome expectations and the O12 proof-input conversion are the
already approved logic. O12 preserves exactly the three upstream canonical
import/path edits. Its new current preimage is
`9d77da3e2286456e20c77e9b2178b491f73b88be9f0571a6d20a2293fa59683b`;
its mapped postimage is
`b878f320cc32509e8b4f272fa641cae72a023d748fa5e43f977f2b27f4290505`.
No guest source, fixture, native oracle, marker, test cap or semantic assertion
changes. Three independent prerequisites remain byte-identical: the clone
regression test and the host-record and V6 disposition reports. Only this author
report receives the rename addendum. The final manifest records all current
preimages, absence declarations, postimages, ownership and the exact patch.

### Current execution, not inherited counts

All commands use this clone's own HOME and npm cache, outside-checkout TMP,
`env -u TERM`, `SKIP_SYNC_SKILLS=1` and `HUSKY=0`. No original archive,
provider, LLM or live skill sync was accessed. Commands ran sequentially without
timeout or worker overrides. Starts, ends, exits and raw logs are retained.

- Fresh standard forced build: **68/68**, **0 cached**, exit 0; ended
  **2026-08-30T08:58:36.103Z**.
- Mapped focused filesystem/context/prototype/V6/Float/Map selection: **199/199**.
- O12: **10/10 source + 10/10 built**, including eight pending proof variants and
  eight completed follow-ups per API mode. All **36 typed child observations**
  are retained. Whole five-row journals, request/proof IDs, aliases, exact Error
  stack and callback non-invocation checks remain intact.
- Additional canonical/legacy packaging, SDK, CLI and bundle-graph unit tests:
  **94/94**. These are additional to the **219** focused tests, not a root suite.
- Configured ESLint, configured build types and workflow lint: exit 0. Separate
  four-fixture owned type check: zero diagnostics, exit 0.
- All **49** bounded workflow observations were executed anew: ten O15, twenty-two
  Float, ten ordinary/null/old-lossy controls, three exact literal raw observers
  and four separately qualified raw-domain controls. No new full-root suite was
  run; the publisher owns that gate on its actual merged main.

O15 preserves the exact original source SHA-256
`0986c4485dbc6cfd7922143087ea053198118925a04aa44e5c1b5812f313b5dd`,
seeds 123/42, shared random/time/UUID schedule and caps **12 s / 256 MiB / 16 MiB**.
All ten native/source/built/producer/fresh outcomes have ten passing anchors,
54 draws and clock 1006. Full typed graphs and replay journals match the retained
oracles; fresh replay makes zero new host calls. The earlier literal producer
observer mismatch remains explicitly recorded, not silently rewritten.
Float preserves native traces of **111/100/89**, full camera returns, typed
pending/completed graphs, caller bytes, aliases and complete journals.

O12 changes only the left fulfilled proof input through the public converter.
Minimal right proofs retain exactly the missing Error branding and stack; the
three raw-left ordinary nodes remain separately observed, and the genuine-null
control remains distinct. Complete genuine receipts preserve identity and exact
stack. Native-fields controls retain their original native stack and missing
branding qualification. Every completed follow-up has zero host calls and zero
new proof requests. No actual output is normalized.

Old-lossy captures still reject instead of receiving a prototype graft. The
exact raw Float literal observer still exits 1 for source and built, versus
native exit 0; these are preserved qualifications, not a claim that all raw
prototype differences are irrelevant. The four narrow guest-domain controls
pass their full descriptors/keys/value checks and five negative comparisons.

### Actual packed public surfaces and CLI evidence

A local `npm pack --ignore-scripts` captures the already completed standard
build; it is version `0.0.0-dev`, not an npm release. The captured package is
extracted into owned TMP and resolves external dependencies through this same
clone's locked installation. This is not claimed as a separate clean npm install.
The extracted public package verifies exact namespace identity and export
conditions for canonical `poe-code/safe-js`, `/core`, `/cli` and their
`poe-code/safejs` aliases. Root/core share the documented Budget constructor;
SafeFS root/core share their documented constructors and factory. The private
workspace name is `@poe-code/safe-js`; no old private-name compatibility is
promised. In particular, `declareHostOperation` is not a `/core` export.

Both actual packed bin aliases resolve to the same CLI target and exit 0 with
identical complete help, headed `Usage: poe-safe-js`, including the compatibility
alias notice. The two accepted screenshots are
`screenshots/packed-canonical-help.png` and
`screenshots/packed-legacy-help.png`; both were visually inspected. Their complete
help is legible and untruncated. Three extra bounded public SDK examples return
exactly `0.10000000149011612`, `true` for numeric locale ordering, and
`TypeError: example failure`. This does not claim a new SIGINT/recovery validation.

Preparation failures remain in the packet: initial screenshots addressed absent
root self-bin links and captured only headers; they are not accepted evidence.
The first extracted-package import lacked external yaml before dependency binding.
A second author smoke incorrectly assumed an extra core export; static current
source disproved that expectation before the corrected public-contract smoke.
Author-only adjudicator realm/schema/partial-accumulator errors are retained;
none changed guest results or reran the 49 workflow observations.

### CPU release, evidence and handoff

The final runtime command ended at **2026-08-30T09:10:36.334Z**, exit 0.
Major CPU was released at **2026-08-30T09:10:44.690Z**, with no owned running
commands. Only light completed-output review, formatting and sealing followed.
Noether's rename report is static prerequisite evidence, not this packet's new
independent runtime approval. Earlier un-reaped historical parent status and
HOME uncertainty are not retroactively cleared; all current command statuses
are explicitly reaped.

The new evidence root is
`out/safejs-remediation/replay-prototype-rename/candidate`.
It contains complete command receipts and logs, all current raw workflow outputs,
full typed O12 receipts, graph/journal adjudication, retained failed attempts,
local package identity, screenshots and exact publication images. Generated
untracked evidence/build assets are excluded from the explicit publication list.
Independent Noether review and publisher current-preimage/full-root checks remain
required. This handoff does not publish, approve a release, or reopen other audit
families.
