# Independent static review of executor overlay v2

August 28, 2026, America/Chicago. **SCOPED DESIGN ACCEPTANCE; EXECUTABLE
PREPARATION HOLD. No import authorization, rootGO, runtime pass, or cohort credit.**

The W03 capability split, exact namespace profile and explicit empty-setup
amendment are acceptable in scope. The frozen patch recipes reproduce the actual
concrete code. This is not a prose-only replacement for v1. Nevertheless, three
concrete safety/qualification defects below need correction and resealing, and
the advertised missing executable admission wiring must exist before importing
the product. Unexecuted dynamic admission proofs are separate future gates, not
retroactive defects in an honestly static preparation packet.

## Authority and authentication

- Exact author commit: `eb468a7e5283525e48a282c40dd98ec7617c4307`.
- Author `tests/comparison/breadth-continuation-20260828/executor-overlay-v2/SEAL.json:1`
  SHA256 `0485cdb55542cd3f90237256f45eee2082003a90b4ba9d1d7827e3212b562b01`.
- Accepted prior independent receipt: `157eb678f8bcb9ed18fd308a21771aa4d6a032ce`;
  `tests/comparison/breadth-continuation-independent-20260828/README.md:1`, SHA256
  `76cfac6b6833e0479b7fb09ebad3d4c97ab80cef5883c98d8bd38c7c15f9fc78`;
  its `SEAL.json:1`, SHA256
  `7625b706c3d70c9fd4ff50db49069e9a72bcef6138d91f89ac9384579b791e6c`.
- Retain **400/402, two false**, and original **391/394, three false**. Original
  reports, both captures and both checker versions remain unchanged, hash-bound,
  and not rerun/rescored. Historical **13/54 versus 47/54**, selected23/unselected31,
  new10 and controls12 remain separate. No new sort samples or historical credit.
- `evidence-v1/RESULT.json:1`: **210/210 static data/integrity checks hold**, no
  checker fault. `evidence-final/RESULT.json:1` independently repeats210/210;
  `FINAL-AUTHENTICATION-POST.json:1` adds8/8 membership/tool checks (also8/8 in
  `FINAL-AUTHENTICATION.json:1`). **Final snapshot:218/218 static checks**, not
  runtime passes or readiness. Repeated captures are not additional unique tests.
- The author seal authenticates14 files; its self and excluded `VALIDATION.json`
  are independently bound to the exact commit:16 current overlay files. Both
  inherited parent manifests and their declared bytes are authenticated. Recursive
  before/after membership checks include new files, directories and symlinks in
  overlay and preparation, not merely the original tracked paths. Root-directory
  membership is checked separately; these snapshots are not an append-proof lease.
- `evidence-v1/RESULT.json:1` contains exact commit/path/length/SHA256 for all
  inspected evidence/source, including the sources cited below. No full closure
  inventory is repeated. Instruction members were neither read nor materialized.

## Accepted additive changes

**W03.** `tests/comparison/breadth-continuation-20260828/executor-overlay-v2/TELEMETRY.json:1`
preserves the original script, seven bytes, status, stderr, copied-file and exact
namespace expectations. Target chunks1/2/1/3 are independently owned; target cat
dispatch and caller-producer acquisition/EOF/return settlement are measurable,
not measurements obtained here. Comparator Latin-1 plus `stdinKind:bytes` remains
the authenticated byte API, not ordinary UTF-8 fallback. Target timers and
unsupported comparator telemetry remain UNQUALIFIED; derived comparator stderr
is not raw stderr. Shared semantic credit is explicitly separate. See
`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/telemetry.mjs:1`.
The malformed-receipt hole in F3 must not undermine this accepted policy.

**Namespace.** The64-entry and64KiB caps apply to `/fixture`, including its root.
Historical scaffold projections independently match before/after getopts and
comparator column captures: target4/0 bytes, comparator191/6436 bytes, giving
total68/255 entries and65536/71972 read bytes. No unknown outside prefix is ignored.
`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/namespace.mjs:45`
rejects unknown paths before stat/content reads, validates stable scaffold fields,
does not follow symlinks and checks bounded whole-root snapshots. This is static
validation of the historical profile, not fresh candidate/provider behavior.
Legacy census/matchers stay separate. Serialized snapshot bounds and record
transport bounds must both be enforced; two near128KiB snapshots plus other
records need not fit256KiB, and overflow must fail rather than enlarge the cap.

**Setup.** One logged empty target exec per case,66 total plus two C11 calls,
is an explicit revision of the original zero-extra-exec requirement. It is not
99 additional semantics, a retry, hidden warm-up, or command invocation. There are
99 semantic exec calls plus at most68 setup exec calls:167 exec calls, distinct
from the at-most123 supervised-child budget. Setup must occur within the same
case child's deadline; C11 and any nested control workers must be counted too.
No extra comparator setup is needed for this target-specific async plugin barrier;
this does not establish equivalent performance/resource costs across engines.

`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/admission.mjs:7`
queues the actual plugin barrier, awaits `shell.exec('')`, records output/status,
then verifies names. Prior plugin rejection propagates. Frozen candidate
`src/shell/shell.ts:163` creates a normal per-exec budget/scope;
`src/shell/shell.ts:233` awaits readiness and runs units only when lists exist.
The setup therefore still creates parser/runtime/cleanup work, although no command
dispatch is expected for empty source. This is not a reset of semantic counters:
the semantic exec gets its ordinary independent per-call budget. No reset code
was inserted. Dynamic zero-dispatch, state/FS noninterference and settlement
receipts remain required. Setup results are currently local report events, so the
future worker must transport them boundedly before qualification or failures.

**Concrete deltas.** All ordered edits have exact cardinality and reproduce:

| File | Pristine v1 SHA256 | Actual v2 SHA256 |
| --- | --- | --- |
| adapter.mjs | `151a6d5e7800443c231712f21c6b5d2a37a5f435ffa278c182d8913b18d26b90` | `e2c3900dc4f3738074521e7302b45e08386e8c93161d9169e1c5eea7f52022a9` |
| controls.mjs | `f94da5b3a51e304cf2799d78a475daccd1704bde84f214aaa8fb222d52021be1` | `79ca5a1de555592a71f4e7941b0d38fb08c720d2b8019a3232599df46c85218c` |

Both files are under `tests/comparison/breadth-continuation-20260828/`, respectively
`executor-preparation-v1/` and `executor-overlay-v2/`; line1 is their module start.
Inherited loader SHA256
`d7baf31b117112d2c9766660242ada224ed0f5b7b3d2599065de7457a22c70a7`
and supervisor SHA256
`cec95c053a7c7dcab2d1117d5dcabb39e07ec6be29bec734a350822f672787dc`
bind exact recipe `29f7f3f0074dbaf41b99e69581364d0c6f1021ae`, not moving HEAD.
C01–C12 exist concretely. C05's data guard is not filesystem traversal proof;
C03/C04/C09/C12 synthetic children are not actual candidate-load acceptance.
C11 now constructs two real public Shell instances, rather than the old promise
model, but no such control was executed here. V1 synthetic12 results are unchanged.

## Narrow code objections: correct and preseal

### F1 — High: a failed phase write can skip owned disposal

`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/adapter.mjs:15`
awaits caller `emit`. Its finally block at
`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/adapter.mjs:97`
awaits `mark('dispose-start')` **before** entering the try that disposes the Shell.
A rejecting emitter on that phase bypasses `shell.dispose()` altogether; a later
phase rejection can replace the primary failure. The normal success path is not
the problem. Make disposal unconditional even when evidence transport fails,
retain both errors, and classify unsafe cleanup as STOP. Preseal a rejecting-
emitter cleanup control. This is a static exception-path deduction, not a run.

### F2 — High: control error classification permits unsafe continuation

`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/controls.mjs:48`
catches every control exception as an ordinary failed assertion, without setting
`unsafe`. C11 runs directly at
`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/controls.mjs:135`,
then C12 starts another child. If either C11 disposal throws at
`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/control-extensions.mjs:42`
or `tests/comparison/breadth-continuation-20260828/executor-overlay-v2/control-extensions.mjs:53`,
the subsequent child is still eligible. Likewise a rejection from `supervise`
at `tests/comparison/breadth-continuation-20260828/executor-overlay-v2/controls.mjs:42`
escapes before its receipt-based unsafe classification. Distinguish ordinary
assertion failures from unknown/failed resource settlement; the latter must stop
before C12/any next case, retaining an explicit unrun tail. Preseal controls for
both exceptions. An outer supervisor alone cannot stop this internal continuation
after the helper catches the error. This does not demand every ordinary assertion
failure stop the cohort.

### F3 — Medium: incomplete telemetry can become fully qualified

`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/predicates.mjs:7`
provides an UNQUALIFIED fallback only when `report.telemetry` is null/undefined.
For `{}`, or a partial object lacking unsupported channels, both status filters
can be empty. With matching shared semantics, lines12/14/18 then produce
`pass:true`, `QUALIFIED`, and `completeTelemetryQualified:true`. The concrete
adapter normally supplies all channels; this is a malformed-receipt/admission
hole, not evidence it emitted such a report. Require the frozen per-engine schema,
all expected channels and valid statuses; missing data is UNQUALIFIED or rejected,
never complete. Add immutable empty/partial/malformed receipt controls, preserving
the unchanged shared literals and the intentional W03 `pass:null` distinction.

## Missing preparation versus future runtime proof

**P1 — High, pre-import preparation still incomplete (advertised HOLD).**
The old `tests/comparison/breadth-continuation-20260828/executor-preparation-v1/prepare.mjs:26`
has only availability/synthetic routes. V2 exports take an already imported
`library`; authorization fields are trusted caller assertions, not a staged-load
admission mechanism. Neither the sealed file membership nor those exports supply
an actual cohort worker/coordinator that stages exact fresh/moved views, installs
the load guard before import, denies old/source/ambient resolution and egress,
authenticates assets, transports reports, counts all work, and applies the outcome
gate. Author README correctly disclaims an executable99-case release. Implement
and preseal that bounded wiring; do not call the missing code a runtime-only proof.

The ESM hook at
`tests/comparison/breadth-continuation-20260828/executor-preparation-v1/observe-load.mjs:27`
authenticates returned module source and rejects missing/non-module source; its
receipt explicitly says `evaluationProven:false`. It is neither CJS/worker/WASM
coverage nor an offline sandbox. Concrete guards for applicable non-ESM/asset
paths must be sealed before permitting those loads; if applicability remains
unknown, a separately authorized bounded probe must refuse unsupported loads
without awarding credit. Do not demand irrelevant formats merely by name.

**P2 — High, W07 observable implementation absent (advertised HOLD).**
The adapter initializes `additionalObservations:{}` at
`tests/comparison/breadth-continuation-20260828/executor-overlay-v2/adapter.mjs:14`
and never fills W07's three original observations. The inherited predicate at
`tests/comparison/breadth-continuation-20260828/executor-preparation-v1/predicates.mjs:10`
requires them, so matching output alone cannot qualify W07. Seal real Memory
stat/access(X_OK), non-execution and0755-preservation instrumentation, plus
controls, before the actual full cohort. Observing those mechanisms work is a
later runtime gate. W07 is not silently dropped or credited as output-only.

## Complete preexecution checklist

### Before any actual product/comparator import

- [ ] Preserve this exact review and prior receipts; version corrections rather
  than changing either sealed packet. Correct F1/F2/F3 and obtain a different
  static freeze. Record separate root authority for bounded admission/control
  imports; this report grants none. Bind the actual freeze hash, not a truthy flag.
- [ ] Seal P1's actual coordinator, worker, supervisor, loaders, guards, report
  writer/assessor, all12 control families and new defect controls, tool identities,
  public API bindings, schedule and exact bytes/modes. No mutable code generators
  or post-import bootstrap patches. Use the verified v1/v2 deltas as history.
- [ ] Bind accepted67eab candidate and full pack6608d255, comparator3.4.2 archive,
  lock/dependency/asset closure and explicit installed/moved projections. Original
  3843-regular-file availability is not full staged closure. Select reuse versus
  rebuild explicitly; neither installing nor rebuilding is authorized here.
- [ ] Preseal a safe projection/materialization recipe excluding the declared
  instruction member **without reading/copying/loading its plaintext**. Admit
  this as a projection, not an identical complete extracted tree. Fix source,
  old-layout, ambient dependency and symlink/unknown-entry rejection rules;
  inspect staged names/modes/hashes before import and retain post/new-entry guards.
- [ ] Install the bound load witness before the first import. Seal supported
  ESM and applicable CJS/worker/WASM/asset mechanisms, denied-fallback tests and
  evidence flush behavior. Unknown formats stay refused. Freeze offline/no-host-
  process, no ambient credentials/network/private/XAN admission boundaries; do
  not mistake unrestricted `node:` resolution for capability denial.
- [ ] Preserve all23 legacy literals, profiles, limits and matcher qualifications;
  all10 new literal workflows and exact scaffold/namespace predicates. Seal P2's
  W07 observers before full-cohort import. Keep W03 shared bytes independent of
  per-engine unsupported telemetry; never turn UNQUALIFIED/null into a pass.
- [ ] Freeze work accounting: serial fresh children, one attempt,99 semantics,
 66 target setup plus2 C11 setup execs, no resets/retries; at most24 control
  children and123 total children, counting any nested/control wrappers. Admission
  tools/probes and their child/import counts need separate finite budgets. Setup
  shares each child deadline and cannot reset it or mutate fixture expectations.
- [ ] Seal transport and aggregate resource enforcement: per-engine limits,
  whole-VFS caps,128KiB/snapshot,256KiB metadata/child, per-stream64KiB new capture,
  legacy combined8MiB capture,256MiB archive,30s+2s+1s child lifecycle and75-minute
  outer guard. The inherited supervisor takes per-stream `outputCap` at
  `tests/comparison/breadth-continuation-20260828/executor-preparation-v1/supervisor.mjs:11`;
  a future caller must enforce the legacy **combined** ceiling explicitly, rather
  than passing8MiB to each stream. README's “combined child captures” wording must
  distinguish the256KiB record pipe from separately bounded stdout/stderr.
- [ ] Seal explicit final outcome composition. Neither the workflow predicate
  nor `supervisor.natural` alone establishes readiness: require execution result
  or complete thrown error, no capture/admission errors, settled owned producers/
  tracked resources, disposal, successful worker exit AND stdio close, process-
  group absence, load receipts and intact guards. The supervisor's natural flag
  does not itself require exit code0. A report with `cleanup.error` must never get
  operational credit just because non-W03 byte predicates pass. Bound transport
  failure, late rejection, forced-reap and unsafe-stop paths before importing.

### Runtime admission, separately authorized, before semantic cohort credit

- [ ] Authenticate the actually materialized fresh and physically moved views,
  complete admitted projection and assets; demonstrate no old/source fallback,
  no extra entries or instruction content access, and intact pre/post guards.
- [ ] Obtain actual loaded-source/package/parent/resolution evidence and relevant
  evaluation/export-call or asset-use witness; observe applicable non-ESM denial
  or support. ESM source-return hashes and archive listings alone are insufficient.
- [ ] Execute the sealed controls through the actual designated admission and
  supervision paths, including actual Shell C11 pending/rejected setup, not just
  its old model. Authenticate all12 outcomes and new F1/F2/F3 controls; preserve
  synthetic labels, deliberate rejects and unsafe unrun tails. No control credit
  is inferred from presence, syntax, hashes or this review.
- [ ] Observe separately logged setup bytes/status, zero command dispatch,
  registry identity, state/FS noninterference and natural cleanup. Show bounded
  producer/dispatch telemetry where supported and the real W07 observations.
  Unobservable channels remain UNQUALIFIED; unchanged output is not instrumentation.
- [ ] Establish actual process/stdio/group cleanup, cancellation/transport and
  guard behavior, finite accounting and no hidden retry/reset/extra execution.
  Only intact natural admission can authorize starting the semantic schedule.
- [ ] Obtain separate cohort GO after admission acceptance, then credit each
  case only after its own lifecycle and post-guards settle. Keep23/10/layout,
  controls, unselected31 and old54 results separate. Full comparator admission,
  superiority, provider performance and timing remain held/unclaimed.

## Evidence and ownership closeout

`static-check.py:1` and `final-check.py:1` use only independent standard-library
data logic and read-only Git; no repository module, executor, validator, control,
product, comparator or native oracle is imported or run. Historical JSON is data,
not executed code. No new timings, builds, install/network/private/XAN actions,
temporary extracted trees or long-lived processes were created. No data-check
fault occurred in the first capture; later captures remain separate and immutable.

Initial ownership/index facts are in `INITIAL-STATE.md:1`. Only new owned paths
are staged and committed with explicit-path `git commit --only`. Foreign state is
untouched. `SEAL.json:1` binds this report, both checkers and all static receipts;
the final response supplies the full commit and owned cleanliness. This is a
bounded handoff, not self-assignment of another review or permission to execute.
