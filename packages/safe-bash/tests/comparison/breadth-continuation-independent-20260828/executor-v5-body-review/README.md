# Independent actual V5 body review

August 28, 2026. **PREEXECUTION_FINDING — NOT ACCEPTED; actual admission HELD.**

## Finding F1: wrong entry parent reaches the consumer

The original frozen `entry-parent-denied` expectation does not hold for the actual
candidate loader. `executor-v5/loader.mjs:36` tests the parent only when the
specifier equals the bare engine name. The worker→consumer edge is governed by
URL membership at `loader.mjs:42`, with no authorized entry-parent binding.
`consumer-scope.mjs:38` returns the consumer URL as the expected **bare-import**
parent, not the authorized parent of an import **of the consumer**.

In the sealed independent holdout, an extra owned, allowlisted
`unauthorized-parent.mjs` re-exports `./consumer-v5/consumer.mjs`. Actual candidate
loader and offline-guard bodies accept it. The target stub evaluates and returns
`target-stub`; the evaluation sentinel is `["target"]`. Three source witnesses
are retained (intermediate parent, authentic consumer, target stub), there is no
caught error, and the consumer→bare resolution is marked accepted. Expected:
refuse the wrong entry parent before consumer/stub evaluation. Actual: success.

Concrete evidence: `capture-01/entry-parent-denied.json:1`, SHA256
`9b8626751ff9bbc2302761c6bf75e630e0bfaeb9430ef84e767403d8b143c1fd`.
The inserted parent text,54bytes, is retained at
`capture-01/entry-parent-denied/view/unauthorized-parent.mjs:1`, SHA256
`b1e46a689f8795b93f4702a4d8a356e3ad0a2d278f4e30c8f7e74fe2c0c9d184`.

This is a failed presealed entry-edge requirement, **not** evidence that an
unallowlisted module loaded, that a real engine was bypassed, or that trusted
host JavaScript became adversarially sandboxed. The synthetic view deliberately
binds its extra parent; no author allowlist/code/policy was edited. The production
worker still directly imports the correct consumer at `worker.mjs:44` after
authorization. This holdout exposes the missing mechanism rather than claiming
that the currently sealed real closure contains an exploit.

The distinct supplemental `bare-parent-denied` control passes with
`CONSUMER_PARENT` and no target evaluation. That is the consumer→bare-library
edge tested by the author's S10, and is **not** a substitute for the original
worker→consumer expectation. No expectation was changed after execution.
Resolve F1 in a newly sealed author recipe and independent review; do not reuse
this packet as a positive different-review receipt or issue a grant from it.

## Immutable identities and cohorts

- Author recipe: `d6369210fccf5623c786bd9d4c9409a6384d0ad3`.
- Author evidence: `d8559e1f3de0308b96bc2e8e1c2b0e682fc1df25`.
- Candidate SEAL: `afb0a451dba689d0337211892c73fcee2d84ffa83567ca8eb1ae1e8e73568986`.
- Candidate evidence manifest: `ef2a3dc0ab950a3375c7f84ed06f2579010e35919c784b45ea99a6385db5c2c9`.
- Independent source preseal commit: `aca546d437b80c5f126f02e4b914860dc65912e8`.
- Independent PRESEAL: `f0fc858b6143ef33f6daf3440cfebe57145240dfa413bf8e00404e11e2b45207`.
- Fresh RESULT: `d1ffc02d241c340a4aab63c0fc937f75a7f79c1dc46111c9b7f9a33b2b417941`.

All216 sealed files, plus SEAL and the evidence manifest, were authenticated to
their actual immutable recipe/evidence Git blobs at start and before/after the
replay. Actual imported helpers came from their original candidate URLs, not a
clone, proposed implementation or incidental HEAD. No candidate file changed.
`BEFORE.json:1` and `capture-01/INPUTS-AFTER.json:1` retain218 exact identities.
All six versioned changed bodies and the new scope body were statically inspected.

| Cohort | Fresh result | Meaning |
| --- | --- | --- |
| Original15 adapted to actual V5 |14pass,1finding,0unrun |4positive imports pass;10/11negative refusals pass |
| Supplemental guarded imports |6/6 |3scope/parent negatives,3actual C12 stub outcomes |
| Separate helper assertions |14/14 |3DATA metadata/identity checks and11SYNTHETIC in-process controls |
| Syntax-only |4/4 |Own audit, runner, worker and helper driver; not engine acceptance |

Total substantive assertions35:34pass,1finding. This does not turn the failed
original15 cohort into an acceptance. **Classification disclosure:** the presealed
harness calls its14 helper assertions `dataControls` and PRESEAL calls them DATA;
only the first3 are metadata/identity DATA. The remaining11 exercise modeled
phase/operation/lifecycle/ledger inputs and are more accurately SYNTHETIC. Their
IDs, expectations, execution and results are unchanged; the honest overall split
is3DATA plus32SYNTHETIC, not14 metadata-only proofs. No cohort is rescored.

The preceding `executor-v5-review` result stays15/15 **own model**, four positives
and11negatives, frozen in `bfff3dfed06d9144c82652246251f654c8bd26e7`, PRESEAL
`a1fd3018e3a0a63567ee8709766c1073bb48e6755701cf0a24609df9e6eb6074`, evidence
`dc5cf2a05a9bd9269f787602466a591a9abe8288`. That freeze was pre-handoff and
pre-execution, **not pre-appearance**, and did not read successor bodies. Its
README/FIXTURES/EXPECTATIONS/PRESEAL were read, not edited. This new adapter and
supplemental controls were separately presealed after body inspection.

Author4DATA+12SYNTHETIC,12reaped and11syntax remain separate author evidence;
they were not rerun or counted as our results.

## Wrapper and projection mechanism

`CONSUMER-SCOPES.json` SHA256 is
`bb15018f97824b908421464cf45b325a0e3176698a183b6ef58597423066e664`.
The actual boundary files differ from the predecessor's77byte example:

| Role | Exact private package name | Bytes/mode | Boundary SHA256 |
| --- | --- | --- | --- |
| Target |breadth-target-consumer-v5|69/0644|e41794ff60f445d0fd049872c54d3c914e972fca136f642eaead567fee35d4ca|
| Comparator |breadth-comparator-consumer-v5|73/0644|2c8f2dcd28f18ce0d7151958fd07d2280fcf3d7e994e4d5237c20d89bfcd439a|

Each is one JSON line plus LF with `private:true,type:"module"`. Both names are
distinct from both libraries. Target entry is `<view.root>/consumer-v5/consumer.mjs`
(61bytes,0644,SHA256 `2c8baf95aacda393a4d4f347f49ee5527749a377ce72d6e1dbe0d5a624bcbd2c`);
comparator entry is `<view.root>/benchmarks/consumer-v5/consumer.mjs`
(58bytes,0644,SHA256 `aa607a53a64e71658fd0c7ca39a6c5e14c311242433c0d41efbccdc15816edd1`).
The wrappers retain literal bare imports and exports; there are no aliases,
source fallbacks, package rewrites or new general parent exemptions.

`scopeDefinition` authenticates author wrapper sources; `wrapperEntries` binds
exact projected metadata; `authenticateConsumerScope` checks path, complete
entry equality, existence, bytes/modes/hash, then private package JSON before
installing hooks. Missing boundary fails `CONSUMER_BOUNDARY_MISSING`; same-size
wrong-library-name and wrapper-byte mutations fail `FILE_HASH`; mode mutations
fail `FILE_METADATA`, all before any loader source witness/evaluation.

Candidate loader retains strict resolved-URL membership, metadata/hash checks
before `nextLoad`, and equality of actual returned source bytes before evaluation.
Fresh source mutations produce `LOAD_HASH`/`LOAD_METADATA`, no stub evaluation.
Intended-but-unbound target fails `UNBOUND_MODULE`. Own synthetic bare exports
resolve through exact consumer parents, independent of an unrelated cwd. The
move case physically renames its capsule view and records old-origin absence.

The two original diagnostic controls intentionally omit `view.engine`, as
presealed, to exercise the actual loader's scope-less synthetic path: enclosing
self-reference and missing-boundary resolver fallback are denied as unbound.
They do not demonstrate acceptance of missing scope by the actual engine worker.
The genuine engine-scope missing-boundary case refuses before hooks are acquired.

Candidate metadata remains `67eab12e315054907ef4ef435c6bbca2f59e0c36`, full
target pack SHA256 `6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`.
Target858 original file entries project to860 each installed/moved; just-bash3.4.2
closure3844 includes one excluded instruction member, retaining3843 entries and
projecting to3845 with its two wrappers. Comparator archive SHA256 remains
`f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d`.
These are authenticated **metadata/index computations**, not actual archive or
deployed closure qualification. No archive was opened/staged/imported here;
the instruction entry was inspected only as filename/size/mode/hash metadata.

## Inherited safety: evidence and limits

The eight V4 bodies safety/operations/launch-ledger/loaded-outcome/supervisor/
controls/adapter/predicates match their prior V4 seal identities exactly; results
retain all eight SHA256 values. Changed V5 worker/coordinator/authorization paths
were read directly rather than inheriting author-positive summaries.

- **Operation before import:** V5 `worker.mjs:32` authenticates authority, then
  `:33` authorizes the phase/operation; config path/ordinal and exclusive claim
  precede view/tree checks, scope/loader/offline guards and `:44` import. V5
  synthetic worker authorizes controls before its loader too. Fresh actual
  operations-helper inputs reject case-in-admission, probe-in-cohort, old V4
  output root, wrong run/plan/command. No actual CLI worker or authority() grant
  loading was invoked; worker ordering is static actual-body evidence, not a
  newly executed full-prefix/real-authority claim.
- **Primary retention:** inherited `settle` uses a separate hasPrimary flag;
  fresh null and undefined throws retain exact identity with ordered body,
  emitter, disposal and final-emitter errors. Disposal runs once. Adapter source
  still propagates hasPrimary/errors and cleanup state; no engine is injected
  into an actual semantic adapter execution in this review.
- **C12:** three freshly imported own modules execute under actual V5 loader
  and offline guard. Actual returned status/output/effects feed inherited
  `assessLoadedNoop`. Noop gets designated-control credit; status23 is preserved
  and rejected; a real returned `part-aa` effect becomes an interpreted file,
  changes its predicate to pass and rejects noop-control credit. This is not W02
  product execution and does not claim complete-effect coverage from three cases.
- **Enrollment/persistence/tail:** source inspection confirms enroll before
  prepare, exact handle attachment before result persistence, shared receipt
  retention and emergency cleanup on failure. Fresh actual EEXIST at prepare
  records ENROLLED→UNSAFE_STOP, no acquisition, and refuses later enrollment;
  fresh serial failure retains UNRUN_UNSAFE_TAIL. Post-child persistence collision
  remains the prior independently frozen V4 coverage, not a freshly repeated
  test here. Our22 real child handles all close/reap through unchanged supervisor.
- **Offline policy:** unchanged actual guard protects assets and denies host
  execution/network/worker/WASM routes; owned descriptors/timers are accounted.
  No denial test attempts network/native execution here. No SafeJS/js-exec
  substitution, install, new allowlist policy or provider claim is introduced.
- **W07:** unchanged predicate preserves original status/byte/FS checks and the
  failed nonexecution obligation, with comparator dispatch UNOBSERVABLE,
  nonexecution UNQUALIFIED, semantic/nonexecution credit false. Bytes alone do
  not establish nonexecution. Nothing in this review qualifies W07.

V5 coordinator's staged view checks, child ledger, strict transport, unsafe stop,
remaining-tail construction and emergency final-persistence report remain in
their actual inspected callpaths. No opaque cleanup guarantees are inferred.

## Fresh admission interface: inspected only, blocked

`ADMISSION-INTERFACE.json:1` gives the exact candidate command, receipt fields,
hashes, ordered14 operations, limits and source pointers. **It is descriptive,
not a grant.** There is no valid positive different-review receipt from this
review. `REVIEW.json:1` says PREEXECUTION_FINDING and cannot satisfy
`authorization.mjs:50`'s PREEXECUTION_ACCEPTED requirement.

The unexecuted command template is:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --max-old-space-size=256 tests/comparison/breadth-continuation-20260828/executor-v5/coordinator.mjs admission <FRESH_ROOT_RUN_ID> <PINNED_AUTH_JSON>
```

Root must select a fresh `[a-z0-9-]{1,64}` runId; no runId is granted here.
The auth JSON supplies `review` and `grant` references, each immutable40hex
commit, relative non-instruction path and64hex SHA256 of exact committed JSON
bytes. Root receipt needs role/root, phase/admission, attempts/1, exact candidate,
pack, recipe, review hash, runId, absolute V5 outputRoot, phase-plan hash and
exact command object. No operations array is an additional grant field: its
ordered contents are committed through phasePlan's hash. The command object's
property order is significant in current implementation's JSON.stringify check.

For this inspected recipe the admission plan hash is
`03463349729bdd298b0ff3ca8c1066c568daad4d5049532e957ce825374ce475`, not the
OPERATION-PLAN file hash `4112bb1cf2da78344f8b20eef82e0709f95b33067d6e07b610d66a22a12c9ff4`.
A repair/reseal changes recipe identity and requires renewed review/grant; do not
reuse the currently described values as authority for changed bytes.

Preparation is the body/fixture review, immutable identity checks, exact wrapper
projection and coherent review freeze. Future runtime admission additionally
requires fresh root receipt, authenticated Node/git tools, all live sealed inputs
and allowed namespaces, exclusive authority lock and fresh output directory,
actual pinned target pack and comparator archive/closure availability, exact
staging/tree inventories with instruction omission, physical move/old-origin
absence, guarded installed/moved/comparator public exports, C03–C12 controls,
two actual C11 empty setup calls, closed resources and accepted final admission.

Exactly14 planned workers fit the27 ceiling; admission has2 C11 setups and0
semantic calls. The later99 semantic operations need a **separate** cohort grant
and acceptedAdmission path/SHA binding to a valid RESULT/STAGED pair. None are
authorized or executed by this review. Concrete full closure, projection and
moved-load qualification remain future runtime duties, not implications of
stub success or the metadata counts above.

## Preservation and closure

One invocation only; no retry/rebaseline.22/22 children exit0/close0 naturally,
with no signals, no supervision failures and empty stdout/stderr. Each acquires
at most its own bounded Node stub work. All acquired offline guards report0
pending resources,0 descriptors and0 violations; null guard receipts mean
preflight refused before acquisition, not invented zero-resource observations.
Every capsule's recursive before/after inventory matches, including added-entry
detection. Final process checks confirm22 exact PIDs,22 owned groups and the
runner PID41373 absent. Four syntax processes returned synchronously before
preseal; their individual PIDs were not captured, so no separate PID audit is
claimed for those four.

Candidate216 input hashes/modes plus seal/evidence identity remain stable before
and after. Candidate namespace comparison and actual authenticatePacket walks
detect new recipe entries, excluding designated mutable runs; this is not an
append-proof claim for every historical evidence tree. Own evidence manifest
retains all177 raw capture/stub files and their actual physical modes. Git only
preserves executable bits, so captured0600 mutation modes are represented in the
manifest/receipts rather than promised for a later plain checkout.

Historical400/402,391/394,13/54 versus47/54,V3 independent35/44 nine failures,
V4 preexecution29/29 (not actual acceptance), and actual
`d40af0d52381a138f2dabb415d343526ad015722` UNSAFE_STOP firstworker UNBOUND_MODULE,
1/14 launched,0qualified,0C11,0semantics remain unchanged. Old grant c1b03b64 is
consumed and unusable. Product/comparator/native execution, archive staging,
engine imports, C11, XAN, network/install/timing, fresh grant and99semantic run:
**zero**. No superiority, full completion or72-hour-duration claim is made.

Final staged whitespace check reports only the two deliberately space-padded
wrong-name package JSON fixtures. Their same-size byte mutations are presealed
test data, so stripping their trailing spaces would corrupt the evidence. Source
and documentation checks are separate. A concurrent foreign modification of
`src/shell/parser.ts` appeared after the recorded post-audit; it was neither edited
nor staged here and is excluded from the explicit owned-path evidence commit.
