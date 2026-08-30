# Independent breadth v3 preexecution review

August 28, 2026, America/Chicago. **PREEXECUTION HOLD. No runtime admission,
engine import, root authorization, semantic GO, or breadth score is issued.**
The author has supplied real executable wiring and fixed the principal F1–F3
examples. The remaining objections are bounded below; this is not a request to
restart the original review, add command families, or rerun historical cohorts.

## Exact freeze and preserved evidence

- Active recipe: `e7f0981b9abfddb27d946c991e5860e30365166c`.
- Handoff: `8666174d2e2fc6a16a2f7d8696d21f56531ccf98`.
- Author SEAL SHA256, **initial = final**:
  `20e82f8030075adbd2772c54c534c3db5e6eec0fa641a72b0f2fa9d4cf372df8`.
- Prior independent proof: `a66683b5bf9b0274705f5f6e61ff1e35aee1db46`;
  `tests/comparison/breadth-continuation-independent-20260828/overlay-v2-review/README.md:1`
  SHA256 `25f4d745b514a84e53970d3687f41be247924e7c378584dc53599572609c6528`.
  Its report and seal are bound, not rerun or rescored.
- Independent source/expectations/input preseal commit:
  `ecae08ab0fba8a13669584293468e13d70bffe4f`, sealed at
  `2026-08-28T10:35:44.450Z` (05:35:44 America/Chicago).
- `FREEZE.json:1`: `70789abbc58c2b04cb15f56bf05b7e3d496a25b1750028297dde5fe40eaa32ba`.
  It binds146 regular files, including80 author recipe members, archived Git
  bytes, the preserved author evidence and independent test sources. Recursive
  before/after author membership has97 entries and detects additions, directories
  and symlinks, including runs. This observation is not an append-proof lease.
- `evidence-v1/INITIAL.json:1` SHA256:
  `1c3fff028b29564161c2cf9491dc9bf9389f06f96f05499cb71e92ca99635254`.
- `evidence-v1/FINAL.json:1` SHA256:
  `32ffb04bfff7bf89c6ab248daa1130cbd85d68b078bf0d875b216d0d59a8b86d`.
  All146 input hashes and modes and all97 author tree entries match initially
  and finally; wrapper hashes differ because final child receipts are included.
- `evidence-v1/RESULT.json:1` SHA256:
  `d5b2037a4bd756cd20c40d6faf3aedba7de198cb8694e198ea6b84d2865a1388`.
  The final local `SEAL.json:1` binds the report, decision and immutable capture.

The four author revisions are composed, not one unchanged invocation:

| Recipe commit | Preserved evidence commit | Meaning |
| --- | --- | --- |
| `d5a68a9f38f5833c8c459195c5a0963fc9b9cab0` | `446206f63258ccbec54b5b0da55aa7302fb46af9` | Initial C03/C05 failures;8 children |
| `4ad7eefb1d65e46db5a33c92d41ad965efda93eb` | `8abf1f2922c47e269a800da0fc5c4330201873f8` | CJS realpath failure retained;5 children |
| `4a33f94a193f640d441b1db77135236efb312314` | `7d5a2e309b1ddfbcc39ffc49a51c43206191b655` | Narrow C03/C04 repair proof;6 children |
| `e7f0981b9abfddb27d946c991e5860e30365166c` | `8666174d2e2fc6a16a2f7d8696d21f56531ccf98` | Final data/binding audit and handoff |

Retain **400/402,391/394,13/54 versus47/54**,23 selected/31 held historical
cases,10 workflows,99 semantic calls and66+2=68 separate setup calls. No original
11/23/54 checks, old validators or author control suites were run here. The first
author C11 raw row says QUALIFIED while its observation is model-only; the current
code relabels it HELD_ACTUAL_C11. Neither that old label nor composition gives
actual C11 credit. All original failed captures remain byte-identical.

## Independent run, not author counts

One run of the precommitted `review.mjs:1`, with the exact Node22.22.2 binary and
`--unhandled-rejections=strict`, returned status1: **35/44 assertions hold**.
That is **13/13 DATA and22/31 SYNTHETIC**, not a new51/51 or12/12 claim.
Nine failures remain untouched:2 F1 non-Error primary values,5 standalone outcome
schema negatives,2 worker phase-prefix negatives. No checker exception, changed
expectation, retry or rebaseline occurred. Counts are named assertions, not every
internal loop iteration, mutated receipt, file hash or product case.

Four independently presealed child modes all satisfy their expected outcomes:
guarded ESM/CJS require; instruction-path/worker/WASM/unlisted-module denial;
strict late rejection (status1); stdout overflow (CAPTURE_LIMIT/SIGTERM). All four
have exit **and** close, PID/group absence, no active parent handle, and no forced
SIGKILL qualification. Exact receipts are `evidence-v1/child-*.json`.
These four children are **additional to**, not a rerun/recount of, the author's19.

The author evidence still reports51/51 data+syntax,20/20 defect assertions,
**11/11 applicable synthetic families composed** and19 reaped children. These
figures are authenticated evidence, not independent runtime reproduction.
Our compressed target/comparator hashes match;858 target members and3844 closure
members are authenticated **metadata**. Neither archive was decompressed here;
no actual target/comparator tree was staged and no engine module was imported.

## Concrete objections and narrow corrections

### R1 — worker does not bind grant phase to work kind

`tests/comparison/breadth-continuation-20260828/executor-v3/worker.mjs:25`
authenticates config bytes and calls authority with the config's phase, but does
not compare that phase to `kind`. At line37 it imports the engine; only later do
lines41/51/80 choose probe/C11/case. A valid admission-phase authority can therefore
reach a case import/dispatch route, and a cohort-phase authority can reach C11.
`tests/comparison/breadth-continuation-20260828/executor-v3/authorization.mjs:36`
validates the supplied phase against the grant, not its permitted operation.

S14/S15 execute the exact preimport prefix, ending **before** installLoader, with
fake trusted dependencies and config bytes. Both expected rejects fail. Prefix
SHA256: `ddd1fd0b3b0cf7c15e55f2b8aeb9b7d1348eb22df12adf77bb2e6fcbcce299fc`.
This is a static/configuration admission defect with synthetic corroboration,
not an actual forged grant, engine run or adversarial-host sandbox claim.

Required delta: before any engine import, admission permits only probe/C11;
cohort permits only the bound scheduled case; unknown kinds fail closed. Bind
the operation/layout/specimen to the committed phase/run plan. The root may
instead explicitly declare the coordinator the sole trusted invocation boundary,
but must then withdraw the stronger claim that worker reauthentication itself
enforces admission-only permission and account for direct-worker exclusion.
This review does not silently make that authority decision.

### R2 — F1 still replaces a null/undefined primary throw

`tests/comparison/breadth-continuation-20260828/executor-v3/safety.mjs:26`
uses `primary ??= error`. If body throws null or undefined and dispose-start
emission rejects, the later emitter error becomes primary. S03 fails for both.
`tests/comparison/breadth-continuation-20260828/executor-v3/adapter.mjs:126`
then publishes that secondary value as `report.error`.

The ordered error list still contains the body throw; the loss is the selected
primary identity/diagnostic, not deletion of all evidence. Error-object primaries,
dispose-on-emit-reject and ordered secondary errors pass independently. Select
the first recorded failure by an explicit presence flag/list position, not by
nullish value. Preserve the original error list and F1 captures.

### R3 — C12's loaded result is disconnected from its rejection

`tests/comparison/breadth-continuation-20260828/executor-v3/controls.mjs:84`
loads the real synthetic no-op and asserts only `observed.evaluated`. It then
creates `syntheticReport(W02)` and overwrites after with before, independently
of the loaded stub's status/effects. The designated predicate rejects that
hand-built report even if the loaded fixture's returned status/effects change.
This is static dataflow evidence, not an extra unsealed execution.

`tests/comparison/breadth-continuation-20260828/CONTROLS.json:1` requires the
observed loaded status0/no-W02-effect substitution. Retain the existing proof as
**load witness plus model effect rejection**, not an end-to-end loaded-outcome
control. Wire the loaded stub's actual status/effects into the assessed capture
and require status0 before crediting C12 at runtime admission. No product change
or actual engine is needed to repair this synthetic control.

### R4 — launched-child accounting is published too late

`tests/comparison/breadth-continuation-20260828/executor-v3/coordinator.mjs:69`
awaits supervision, then writes the receipt, then appends the child at line71.
If receipt persistence fails, that launched child's PID/reap state never enters
`output.children`; line136 derives allChildrenReaped only from that array.
The top-level catch does stop further dispatch and makes the run unsafe, so
this is **not** a demonstrated unsafe run receiving admissionQualified credit.
It is an accounting/cleanup-evidence gap: an empty recorded array can claim all
children reaped despite an omitted launched receipt, including an unsafe one.

Enroll the launch/handle before acquisition, retain its returned state before
fallible persistence, and derive closure from every admitted launch, including
failed receipt writes. Keep serialization serial, no retry, and explicit unsafe
tail. The root admission envelope needs this evidence; a configured child ceiling
and an after-the-fact receipt array do not constitute an active-child ledger.

### B1 — five standalone assessor counterexamples, qualified limitation

`tests/comparison/breadth-continuation-20260828/executor-v3/predicates.mjs:38`
accepts a synthetic otherwise-valid W01 report with missing/nonempty late,
denied loads, missing postGuard, or executionError alongside matching result.
All five presealed S13 assertions fail and are preserved, not reclassified passes.

**These are not five demonstrated coordinator safety bypasses.** The real worker
sets nonzero exit on late/denied/resource failures at
`tests/comparison/breadth-continuation-20260828/executor-v3/worker.mjs:93`;
launch requires settled exit/close/group and post-launch integrity before qualify.
The normal adapter cannot both throw during result construction and publish that
matching result. PostGuard is also produced before the worker's final envelope.
Thus the composed boundary is stronger than the standalone function tested.
Either make its schema explicit and reject contradictions at the assessor, or
document/prove those producer invariants as required inputs. Do not count the
mutated models as actual engine outcomes or alone use them to claim a bypass.

## Concrete mechanism coverage

Source locations in this table are under
`tests/comparison/breadth-continuation-20260828/executor-v3/`.

| Mechanism | Review conclusion |
| --- | --- |
| Coordinator/authorization | Concrete verify/synthetic/admission/cohort routing, committed SHA references, atomic wx grant lock; no automatic admission→cohort. R1/R4 remain. |
| Worker/adapter | Actual dynamic import boundary inspected, probe and actual C11 implemented, fixture-before-empty-setup noninterference explicit. Actual engine branches unrun. |
| Loader/regular-read | Hashes listed regular source and returned ESM/JSON/supplied CJS; guarded require independently exercised. No source fallback admitted. |
| Offline guards | Explicit bound asset reads, instruction path denied before read; network/process/worker/WASM deny-before-action. Trusted-dependency guard, not hostile JS isolation. |
| Supervisor | Separate bounded stdout/stderr/FD3, exact detached child/group, TERM/KILL guards, exit+close+absence. Four independent positives/negatives settle as expected. |
| Transport | Sequence, final-envelope and byte caps; actual EBADF latches failure while disposal still runs. Error/late/nonzero children cannot qualify on bytes alone. |
| Assessor | Status/stdout/stderr/namespace and cleanup/load/resource conjunction, W03 qualification split; B1 documents the additional producer invariants. |
| Projection/moved | Full declared index, omitted instruction metadata, bare consumers, physical rename, old-origin absence, before/after new-entry/mode/hash/symlink checks. Only metadata/model checks here. |

## All12 control families

This is a coverage map of concrete implementations, not twelve independent runs.
Locations refer to the same v3 directory. Retained author success has the scope
stated here; R3 prevents treating the C12 composition as full endpoint proof.

| Family | Concrete route and scope |
| --- | --- |
| C01 | controls.mjs:39 identity positive and wrong candidate/pack rejects; bound author synthetic evidence. |
| C02 | controls.mjs:40 wrong file-hash reject; exact tool hashes independently checked as data, no tool replacement execution. |
| C03 | controls.mjs:41 ESM/CJS/require evaluation/source witnesses; independent guarded require child succeeds. Wrong expected hash hits LOAD_HASH **before** nextLoad, not a mutated nextLoad-source experiment. |
| C04 | controls.mjs:47 unbound-module and offline denials; independent child confirms instruction/worker/WASM/unlisted denies without action. |
| C05 | controls.mjs:51 fresh-tree additions/mode/symlink and instruction-name rejects; independent bounded tree mutations pass and restore. |
| C06 | controls.mjs:61 W03 byte/effect corruption; independent bytes/status/FS negatives and malformed telemetry pass. |
| C07 | controls.mjs:69 status/stderr negatives; author evidence bound, no native oracle. |
| C08 | controls.mjs:70 unexpected FS effects; author evidence bound, independent W03 effect corruption checked. |
| C09 | controls.mjs:71 nonzero/deadline-retired timer negatives; author evidence bound. Our distinct late-rejection/overflow children fail operational qualification and close. |
| C10 | controls.mjs:76 safe ordinary assertion continues; F2 action/pre/post-integrity/unsafe-result stop their tails independently. |
| C11 | controls.mjs:77 and worker.mjs:51 actual pending/rejected plugin route exists but is **UNRUN**. No model or original raw QUALIFIED label counts as actual. |
| C12 | controls.mjs:84 loaded no-op plus disconnected synthetic W02 effect failure; limited proof, R3 requires outcome linkage. |

F3 missing/null/array/partial/extra-channel/empty-reason receipts reject. W03's
original seven bytes, status, copied file and namespace remain unchanged; both
engines' valid synthetic receipt models return shared semantics true, pass=null,
completeTelemetryQualified=false. Unsupported timers/comparator channels remain
UNQUALIFIED. Nothing turns matching bytes into observed dispatch or cleanup.

## Narrow root decision: W07

`tests/comparison/breadth-continuation-20260828/executor-v3/w07.mjs:27` correctly
leaves comparator dispatch unobservable and the original no-execution observation
false. Stat/access/content-read instrumentation and0755 checks are separate.
The admission VFS probe records accessAvailable and events; coordinator.mjs:93
does **not** require accessAvailable for its operational admission boolean.

An explicit `observerQualifications.W07.dispatch = UNOBSERVABLE` is acceptable
metadata **without** changing the original semantic eligibility: no-execution
must not become true, be dropped, or be inferred from output. Under the unchanged
oracle this comparator W07 does not receive full operational credit. W03's
approved shared-semantics exception does not automatically extend to W07.
Root must either permit an honestly unqualified/failed W07 row in the later
cohort, or require a separately frozen valid observer. Plumbing admission and
workflow observation qualification need distinct fields/statuses. This decision
is unresolved here, not a demand for irrelevant worker/WASM/format support.

## Conditions before any engine import

1. Resolve R1–R4 narrowly and freeze the changed harness/dependency inputs;
   preserve this failed run and all author originals. No automatic rebaseline.
   The exact e7f0981 recipe is **not** accepted by this report.
2. Root explicitly approves the phase/kind trust boundary, W07 qualification
   policy, one attempt, run identifier, output root and phase-specific ledger.
   Root identity remains a trusted host binding, not discovery from role strings.
3. Bind the exact candidate67eab12e315054907ef4ef435c6bbca2f59e0c36,
   target pack6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06,
   comparator3.4.2 archive/closure/locks/29 assets, revised recipe, Node/Git tools,
   accepted different review and committed root grant. Recheck hashes, modes,
   no symlinks/new entries, no source/ambient/old-origin fallback.
4. Stage **only after that grant**, within its fresh run root: target installed,
   separately physically moved target and baseline projection. The comparator
   AGENTS member is metadata-only and never read/copied/imported. Unknown entries
   or unsupported required worker/WASM operations stop, never fall back.
5. Enroll active child/resource handles before launch; preserve failed persistence
   receipts, independently bound stdout/stderr/metadata, strict unhandled policy,
   exit+close/group evidence, post-guards, and explicit unrun tails. Parent Node
   flags alone are insufficient: coordinator.mjs:69 currently does not forward
   `--unhandled-rejections=strict` to child args. Worker event listeners are a
   nonzero-exit defense, not the same flag. Freeze that prospective policy.
6. Runtime admission must produce fresh/moved load+evaluation/export/VFS witnesses,
   applicable CJS/asset behavior or explicit fail-closed applicability, actual C11
   positive/rejected pending barriers, two logged empty setup results, zero command
   dispatch and marker/state noninterference, all applicable control outcomes,
   no unhandled errors/guard violations/owned resources and complete closure.
   ESM-only assets do not need irrelevant CJS/worker/WASM positive demands.

## Separately authorized admission interface — NOT executable approval

Existing interface, held pending a usable revised freeze:

```
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict tests/comparison/breadth-continuation-20260828/executor-v3/coordinator.mjs admission ROOT_APPROVED_NEW_RUN_ID ROOT_AUTH_JSON
```

`ROOT_AUTH_JSON` contains `review` and `grant`, each exactly a committed
`{commit,path,sha256}` reference. The accepted reviewer JSON must say
role=different-reviewer, verdict=PREEXECUTION_ACCEPTED and revised recipeSha256.
The separately committed root JSON must say role=root, phase=admission,
candidate,packSha256,recipeSha256,reviewSha256,attempts=1. Root must additionally
bind the precise command/run/output/operation plan and budgets; the current
authority schema does not enforce those additional fields. This report's
`REVIEW.json` says PREEXECUTION_HOLD and cannot satisfy authority.mjs:49.
**There is no usable accepted manifest/root grant in this delivery.**

Prospective admission accounting: three zero-shell-exec probes;11 scheduled
control children (C03=4,C04=2,C09=2,C11=2,C12=1),14 planned total, within the
declared24-control+3-probe ceiling27. Exactly2 C11 empty setup execs, **zero
semantic calls**, no reset/retry/hidden warm-up. One active child at a time;
Git authority reads are separate bounded metadata helper processes, not engine
children or native oracles. Count all launches even on unsafe/persistence failure.

Retain256MiB child heap,30s natural deadline,2s TERM grace,1s KILL guard,75min
outer bound; new stdout/stderr64KiB each, legacy combined8MiB, FD3 metadata256KiB,
each snapshot128KiB, evidence256MiB, staged views160MiB. Legal individual snapshots
may still overflow FD3: refuse, do not enlarge. Workflow-owned namespace64 entries
and65536 bytes plus exact scaffold4/191 entries gives total68/255 and65536/71972
read bytes. Unknown external prefixes are not ignored. Admission's bounded
accounting is separate from99 semantics and66 case setup calls; maxima27+99=126
phase-composed children are not silently described as the older123 ceiling.

Required statuses: PREEXECUTION_ACCEPTED only after repairs; explicit
ADMISSION_PENDING, ADMISSION_FAILED/UNSAFE_STOP with UNRUN_UNSAFE_TAIL,
ADMISSION_ACCEPTED only after all actual gates; per-observer UNQUALIFIED or
UNOBSERVABLE separately. Current per-row QUALIFIED/ORDINARY_ASSERTION_FAILED
and final admissionQualified must not flatten those distinctions. Only the
intentional C09 negative is allowed its specified deadline/TERM result with exact
timer retirement; a positive requiring forced reaping never qualifies.

## Separate root cohort gate and exclusions

Admission acceptance alone releases **nothing** from the99 schedule. A distinct
committed root phase=cohort grant must bind acceptedAdmission `{path,sha256}` to
the actual accepted RESULT and its STAGED hash, same recipe and intact views;
the coordinator then checks recipe/mode/unsafe/admissionQualified and rechecks
projection before dispatch. Keep33 unique specimens in three layouts,23/31/10
membership,99 semantic+66 case setup+2 C11 setup=167 exec calls, not equal cost.
Use the original shared per-case deadlines and per-row outcome checks. W07's
unobservable channel remains in eligibility/outcomes, not quietly removed.

Actual engine admission, staging, imports, C11, semantic/native/comparator
execution, timing, network/install/private/SafeJS/XAN action and deployed-provider
acceptance remain **unrun**. No broad superiority, universal parity,72-hour work
duration, build reproduction or whole-history/full-gate completion is claimed.
Only the owned review directory was edited/committed. No peer/source/root/AGENTS
changes, branch creation, foreign staging or new reviewer/task assignment.
