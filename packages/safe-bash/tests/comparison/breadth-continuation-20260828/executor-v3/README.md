# Breadth executor v3 — separate preexecution packet

August 28, 2026. Additive response to independent design review
`a66683b5bf9b0274705f5f6e61ff1e35aee1db46`. **Different review and actual root
authorization are required before runtime admission. Admission is not the99-case
cohort. No product/comparator imports are authorized by this packet.**

Original11-file packet, v1, v2, independent400/402 and391/394 failures, accepted
218/218 static review, and historical13/54 versus47/54 stay unchanged. No old
validator rerun/rescore. Original23 selected/31 unselected/10 new/12 controls
remain separate. just-bash3.4.2 is pinned, not a latest-version claim.

## Executable entrypoints

Use the exact Node binary in PROJECTION.json. `coordinator.mjs verify` checks
recipe/tool bindings without imports. `coordinator.mjs synthetic RUN-ID` runs
owned synthetic controls only, once into a new runs/RUN-ID directory.

`coordinator.mjs admission RUN-ID AUTH.json` and
`coordinator.mjs cohort RUN-ID AUTH.json` are implemented, but held. AUTH.json
contains `review` and `grant`, each `{commit,path,sha256}` pointing to bounded
committed JSON. The reviewed recipe hash must equal the exact SEAL.json bytes.
Different-review JSON must have role=different-reviewer,
verdict=PREEXECUTION_ACCEPTED and recipeSha256. Root JSON must have role=root,
phase=admission or cohort, candidate, packSha256, recipeSha256, reviewSha256,
attempts=1. Cohort additionally requires acceptedAdmission:{path,sha256} pointing
to the actual accepted admission RESULT.json. Operator-supplied root commit/hash
is the trust anchor, not cryptographic identity discovery or a truthy GO flag.
Every worker reauthenticates the committed authority, exact recipe/tools,
configuration hash, projection and moved-origin absence before first import.

No automatic transition from admission to cohort. No retries, alternate-source
fallback, mutable generator or post-import patching. Product code is never
copied into the recipe. The target pack is **reused**, not rebuilt or reproduced.

## Concrete paths and corrections

- F1: adapter.mjs uses safety.mjs `settle`. Dispose-start transport exceptions
  are collected; disposal still runs. First error identity is retained internally,
  with ordered body/emit/dispose/later-emit errors serialized. Any such error is
  unsafe, never an ordinary product assertion. Execution errors are separate.
- F2: `serial`, coordinator integrity/child guards, and owned assertion tagging
  distinguish a settled assertion failure from control, transport, supervision,
  disposal or integrity failure. Unsafe work records an explicit unrun tail.
  Code0, stdio-close0, no signal/failure, PID/group absence are all required;
  `.natural` or matching bytes alone cannot qualify a worker.
- F3: predicates.mjs validates all five exact W03 channels and per-engine
  payloads/statuses. Empty/partial/unknown/malformed receipts fail. Unsupported
  timers and comparator channels remain UNQUALIFIED. Shared semantics can
  qualify independently, but W03 never becomes complete telemetry credit.
- W07: w07.mjs observes semantic-phase VFS stat/lstat/access(X_OK)/content-read
  calls with the original receiver, target public dispatch, and initial/final
  0755 bits. Counters are never reset. All original observations remain required.
  Comparator dispatch is not exposed by the frozen public adapter: its
  no-execution observation remains false/unqualified, not inferred from output.
  Actual comparator stat/access availability is tested in bounded admission;
  an absent method is reported, not invented. W07 may therefore remain a known
  instrumentation limitation; this packet does not silently change its oracle.
- Adapter setup moves after fixture construction and before semantic execution,
  explicitly adding before/after fixture census and zero-dispatch checks around
  the same one empty setup exec. This is an order amendment, not an assertion,
  budget or literal change. C11 separately observes a pending plugin behind an
  explicit barrier, then positive/rejected setup and cleanup; two setup calls.

## Projection, loads and offline boundary

PROJECTION.json binds target67eab12e/fullpack6608d255 (858 regular members) and
the existing comparator archive, all3844 declared closure members, locks and29
asset names. Target gzip/tar admission checks checksum/type/path/size/mode/hash,
exact membership and end padding. It supports the declared regular-file npm
pack; unsupported archive extensions refuse admission, never expand a budget.

Comparator admission copies3843 authenticated regular files from the declared
existing closure. The one declared AGENTS.md member is metadata-only: its name,
mode and size are checked, its content is never opened, copied or loaded. Source
closure new entries, unknown symlinks and missing files reject. This is an exact
declared **instruction-excluding projection**, not full extracted-tree equality
or a full-history archive proof. No npm install, build, external download or
whole repository census. Directories in fresh views have mode0755.

Target installed and a separately materialized, physically renamed moved view
contain complete package metadata/README/declarations/JS plus a bound bare-import
consumer. Comparator keeps its declared node_modules hierarchy and a bound
consumer. Source, ambient dependencies, old moved origin, unknown entry or
symlink cannot silently resolve. Whole fresh-view membership/modes/hashes are
checked before and after every child, including unused assets.

loader.mjs installs synchronous Node22.22.2 hooks before the consumer import.
ESM, JSON and CJS actual returned/supplied source bytes are hashed and reported;
export evaluation/factory use is separately observed. The guarded createRequire
path retains CJS hooks. Baseline entry static source inspection confirms its
node:module import; no package code was executed to derive this fact.

offline.mjs sanitizes operation access: bound regular asset reads only, no host
writes, network, subprocesses, process exits/kills/chdir/native loading or
replacement hook registration. Unknown worker/WASM creation is **refused before
creation/compilation**, not falsely called supported or exercised. If a selected
workflow actually needs it, admission/cohort stops without credit and returns
that applicability blocker. This is a guard for the authenticated trusted JS
dependency profile, not an adversarial JavaScript sandbox/opaque-host preemption.
No private engine, credentials, native or XAN action is included.

## Schedule, resources and transport

Frozen99 semantic rows are23+10 in three layouts. Exactly66 target case setup
calls plus2 admission C11 setup calls make68 setup/167 total exec calls across
the composed phases, not equal resource cost or167 semantic cases. Setup shares
the case child's original deadline. Admission's three export/VFS observer probes
execute zero shell scripts. Synthetic controls have no engine setup calls.

At most24 control children plus3 admission probes;99 cohort children; serial,
fresh processes, one attempt. Binding Git reads are separate (two per worker,
plus phase authorizations), capped by the child schedule, at most260 across one
admission plus cohort. No hidden nested product children are allowed.

Child heap256MiB; natural deadline30s, TERM grace2s, KILL guard1s; outer75min.
New-case stdout/stderr64KiB each; legacy **combined**8MiB; FD3 metadata256KiB;
each snapshot128KiB. Raw outputs use separate descriptors and are not duplicated
in metadata. Sequence and final-envelope checks reject truncated/late/duplicate
reports. Two individually legal snapshots may overflow metadata: refusal, not
cap increase. Case/receipt files count toward256MiB retained evidence. Staged
package/dependency bytes are separate reusable views (under160MiB), not evidence
archive copies. Input files/modes and directories remain fully indexed.

Workflow namespace64 entries/65536 bytes is only /fixture. Outside exact
scaffold is4 entries/0 bytes target or191 entries/6436 bytes comparator; total
68/255 entries and65536/71972 bytes. No arbitrary excluded filesystem prefixes.
Legacy resource/profile/matcher semantics are retained separately.

## Synthetic validation and future admission

Controls C01–C12 are concrete in controls.mjs: identity, wrong hash, actual
ESM/CJS/guarded-require witnesses, offline/fallback denials, real fresh-tree
newentry/mode/symlink checks, W03 corruption, status/diagnostic, filesystem
effects, nonzero/retained-timer supervision, continuation, actual C11 and loaded
noop rejection. C11 in synthetic preparation is explicitly MODEL_ONLY/HELD,
not an actual product pass. Defect controls additionally cover F1 ordered error
retention, four unsafe-stop boundaries, malformed per-engine telemetry, W07
counterexamples and incomplete report envelopes. No AGENTS files are synthesized.

Runtime admission must still establish real package import/format applicability,
fresh/moved guards, all applicable controls, C11 pending/rejected admission and
actual observer capability. An admission failure is not a product breadth score.
Only a different preexecution review and separate root grants can release these
phases. This is neither full gate nor performance/native/SafeJS acceptance.
