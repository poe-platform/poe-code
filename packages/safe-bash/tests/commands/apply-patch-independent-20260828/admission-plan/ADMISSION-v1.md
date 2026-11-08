# apply_patch independent admission preparation v1

2026-08-28. Independent preparation leaf; ownership is ONLY this directory.
The matrix is another leaf's work. This is a **plan, not admission, ROOTGO,
candidate inspection, implementation review, or executable product acceptance**.
The developer editing utility is not the proposed virtual product command.

## Authority and stop condition

The user assignment is authoritative. Current root AGENTS own-data rule at
line135 and derived-tree rule at line154 apply, as do the command/VFS/IO
contracts identified in INPUTS-v1.json. The parent orchestrator rule is read;
this explicitly assigned leaf performs its own preparation without delegation.
No other file, staging entry, temporary native artifact, or worker is owned.

Read author DATA only at commit
`bf25da0ed51b3d7cddf295a698020c524d4c27a3`: PROFILE-PROPOSAL-v1.md,
CASES-v1.json, DESIGN-CHECK-v1.json and SOURCES-v1.json under
`tests/commands/apply-patch-author-20260828/`. Do not read later author fixtures,
candidate manifests, source, loaders, results or handoffs in this preparation.
Directory-name discovery is not candidate-content inspection. No product import,
execution, build, type compilation, install, moved layout, native/Codex/comparator
engine, network or timing experiment is permitted now.

No genuine ratified-profile/current-contract contradiction was found in the
permitted inputs. Two apparent conflicts are NOT grounds to change policy:

- The proposal's configurable options and three factory names are proposals,
  not inspected public API. Admission enforces the fixed ceilings below. No
  proposed option, public export or default registration is asserted to exist.
  A12's configuration/factory suggestions remain conditional on explicit handoff;
  they do not authorize raising caps or inventing an API.
- The VFS existing-destination identity guard concerns cross-entry copying.
  Ratified regular-file Add replacement and in-place Update are not a copy to
  an unknown existing peer. Move requires an absent destination and actual wx.
  Different-operation unknown identities remain qualified, not proven distinct.

A later genuine conflict stops before candidate import or mutation. Send exact
profile and contract passages to root; do not weaken either or reratify decisions.
The upstream reference is only the author's recorded official Codex
rust-v0.145.0 / `25af12f7e61572b0bc18ddb1008be543b91519b0`. No external source was
fetched here and its Rust bytes were not independently authenticated here. The
author SOURCES document is authenticated, not fresh upstream parity evidence.

## Immutable semantics to carry into the matrix

Zero arguments reads effective stdin; one literal argument does not acquire it;
more than one is status2 before input/FS. There are no flags, filename arguments,
`--`, JSON operations, command-internal shell/heredoc expansion or fallback to
unified patch. Actual Shell handles quoted heredocs and ordinary pipes separately.
Require Add/Delete/Update/Move, bare/named/chained @@ navigation, original-content
first exact forward matching, nonoverlap, suffix-only EOF and no whitespace or
punctuation fuzz. Include omitted first @@, pure additions and context-only moves.
Empty envelope, empty bare hunk, misplaced Move/EOF and move without body refuse.

Fatal UTF-8, no NUL, BOM preservation and surrogate refusal are required. Invalid
patch is status2; invalid updated target is status1. Delete/Add-overwrite may
snapshot binary originals. Preserve unchanged mixed LF/CRLF bytes and original
final-newline state; inserted Update lines use the first existing terminator or
LF, Add emits LF, empty Add is empty, all-lines deletion is empty, unchanged
Update elides its write. No Unicode normalization or implicit whitespace trim.

Relative and virtual absolute paths are allowed. Refuse dotdot components,
empty/control/root/trailing-slash/final-dot targets, directories, observed leaf
or ancestor symlinks (including dangling), non-directory ancestors, normalized
duplicates, file/parent conflicts and known aliases. Backslash, percent, Unicode
and spaces stay literal POSIX data. Identity scopes compare by reference; neither
bare inode nor client/URL/protocol identity proves disjointness. Invalid/conflicting
compareEntry answers and real comparison failures never become unknown/distinct.

Add may replace a REGULAR existing file. Move publishes to absent destination
with actual writeFile(flag:'wx'), then revalidates the source before nonrecursive
unlink. Failed/uncertain destination write never permits unlink. No host rename,
copy, process, eval, dynamic package or network fallback is allowed.

Whole initial syntax, target and content preflight precedes every COMMAND mkdir,
write or rm. Syntax/lexical failure has zero FS calls. Readonly capability rejects
before target reads; actual EACCES/EPERM/EROFS and other real permission failures
are fatal. Unsupported W_OK (typed ENOTSUP/EOPNOTSUPP, permissions not true) is
**UNOBSERVABLE**, never authorization or an inferred grant. Actual mutation may
then succeed or fail according to provider policy. permissions:false alone does
not suppress a real denial. Existing target/nearest parent and deletion parent
are probed as specified, without chmod or destructive permission experiments.

Atime/read housekeeping (notably Overlay garbage cleanup) is separate from
command mutation. Missing parents are created only after whole preflight, one
level at a time with raced EEXIST revalidated. Stable namespace/no competing
writer is the positive profile; revalidation is no lease, CAS, transaction or ABA
defense. Completed parents/files and even a failed write's partial bytes may
remain. No rollback, recursive cleanup, temp rename or hidden rejected files.

Success is exact UTF-8 `Success. Updated the following files:\n` then A/M/D lines
in patch order, literal header paths, Move destination as M, and empty stderr.
Failure has no success summary. Format/usage2, matching/safety/limits/typed FS1,
success0; unexpected rejections escape unchanged before Shell's existing mapping.
Diagnostic prefix/newline, boundedness, operation/path, partial warning and reason
meaning are asserted; upstream prose is not invented as a requirement. Before
runtime, matrix owner freezes exact candidate-independent allowed diagnostics or
finite profile predicates plus wrong-reason/ordinal/path negative controls. A
generic nonzero or broad stderr regex cannot admit a case.

## Fixed cap ledger (inclusive; bytes unless noted)

| Profile field | Ceiling | Exact accounting |
| --- | ---: | --- |
| maxPatchBytes | 4194304 | argv UTF-8 or owned stdin bytes before decoding |
| maxFileBytes | 8388608 | each original/revalidation read and output file |
| maxStagedBytes | 33554432 | sum of all staged output-file bytes |
| maxReadBytes | 67108864 | cumulative originals AND publication revalidation |
| maxFiles | 256 | operation headers; Move counts once |
| maxHunks | 4096 | hunks plus named anchor records |
| maxPathBytes | 16384 | each raw AND normalized absolute UTF-8 path |
| maxPathComponents | 256 | raw nonempty AND normalized components |
| maxLines | 262144 | aggregate retained patch/original/output records |
| maxInputChunks | 65536 | every chunk, including empty chunks |
| maxFsCalls | 65536 | every public VFS invocation, not remote RPCs |
| maxWork | 134217728 | scanned/copied/compared code units, records, probes |
| maxOutputBytes | 1048576 | full precomputed success summary UTF-8 |
| maxDiagnosticBytes | 16384 | command-owned prefix/body/suffix/newline |

Charge before work/allocation; work yields every4096 units with cancellation
before/after/final flush; emitted sink chunks <=16384 bytes. Diagnostic truncation
reserves ` [truncated]\n` inside its ceiling. Limits cannot replace shared Shell
budgets; smaller parent limits remain active. No public Budget is invented.

For every field require minus1/exact/plus1 recipes with independently computed
ledgers, checked arithmetic and sentinel effects. Other caps may bind first:
label such rows BLOCKED_OTHER_CAP or UNREACHABLE_WITHIN_PROFILE, never PASS.
No lowered private limit, static counter, textual assertion, tiny fixture or
synthetic trace proves default-scale dynamic accounting. Work/line/FS-call rows
need actual reachable-path observations and independently bound witness logic;
unobservable private counters stay UNOBSERVABLE. Cross-reference all A02 labels.

## Candidate binding and one-way handoff

BINDING-v1.json deliberately contains nulls, not HEAD defaults. It fixes neither
a candidate nor a release. At handoff root must name the candidate commit or
declared composition, exact source/test delta, all base inputs, author immutable
fixture commit/hash, independent matrix commit/hash, reviewed adapter closure,
build/package/installed/moved identities, tool closure, type routes and explicit
new one-attempt ROOTGO. This leaf cannot mint any of those authorities.

Before candidate inspection, freeze the independent matrix and mutation intent
manifest. After separately authorized inspection, bind actual APIs/entry URLs,
fixture bytes, transformed modules and expected failure routes in a NEW sealed
handoff; do not rewrite this preinspection record. Handoff must not silently
derive candidate fields from the then-current HEAD, working tree, author tests
or discovered export names. Any changed matrix expectation is an explicit delta
with original bytes/failures retained and new qualification, not a silent fix.

Stored commits/blobs/trees require Git object/type/content verification using
developer Git with replace objects disabled. For a **derived-only** composition,
authenticate each input blob, mode, relative name and parent tree; apply the exact
ordered delta; reject duplicate/remapped/conflicting/omitted paths; recompute
Git canonical tree bytes (mode + space + raw basename + NUL + raw object id,
Git byte ordering with directory slash semantics) and hash each tree using
`tree <byteLength>\0` plus those bytes. Recompute blob ids from authenticated bytes
too. Record repository object format; do not confuse SHA256 inventory digests with
Git ids. A derived identity need not be stored: **never require rev-parse or
cat-file success for that derived tree**. Its independently recomputed inventory,
root id and SHA256 transcript must match the declaration. Stored-object claims
remain independently checked. Developer Git is not product Git delegation.

## Existing qualified mechanisms, not a new framework

INPUTS-v1.json binds current bytes/modes and available Git blob provenance for
every selected local helper/tool/contract. Qualification references below are
historical scope evidence, not executions in this task or current certification.
No old CLI is repurposed by swapping its candidate or grant identifiers.

| Mechanism and exact path | Reuse | Applicability / gap |
| --- | --- | --- |
| `tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/controller.mjs` | controller/child/record/finalize; finite git/product/type/tool roles, owner-before-spawn, shared deadline, stop-dependents and durable final receipt | RESULT.md records43 synthetic controls, two actually loaded harness reversions and29 retired child PIDs; not apply_patch qualification. Requires a narrow apply_patch job adapter and new role/receipt controls. |
| `tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/supervisor.mjs` | ownership/retired/supervise | Exact child/group handles; TERM200ms then KILL, timeout+2000ms close guard, <=20 group probes. Captures UTF-8 strings, not arbitrary binary raw: product observations MUST be base64 byte records emitted as bounded JSON, not stdout decoding as a semantic oracle. |
| `tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/deadline.mjs` | deadline(totalMs) | Origin is process start; no reset after setup. Checked deadline is not hard preemption or RSS containment. |
| `tests/shell/indexed-arrays-independent-20260828/candidate-v1/boundary-app.mjs` | census/verifyTree/tarInventory/authenticate | Bounded append-aware census, depth32/10000 entries/128MiB; tar compressed16MiB/expanded64MiB. Rejects AGENTS.md and symlinks. Therefore NOT a full repository/type-data snapshot scanner without a separately qualified scoped adaptation; do not omit AGENTS or large data merely to pass it. |
| `tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v3/staging.mjs` | put/unpack/extract/variantTar | Existing wx writes and member authentication; fixed package format/caps and source-map assumptions must match actual package. No claim this performs independent npm pack/install. |
| `tests/commands/xan-module-review-20260828/actual-review-v1/loader.mjs` | installLoader(root,entries,builtinMap,trustedFixtures) | actual nextLoad bytes/hash/URL and1200-load cap, resolve/realpath guard, blocked ambient loading/network. Historical217 JS loads/layout recorded in actual-review-v2/HANDOFF.md. No mode check at load, no bare package positive, no automatic worker inheritance; add bound pre-load mode/census and wrapper/bootstrap guard qualification, not hash-only proof. |
| `tests/commands/xan-module-review-20260828/actual-review-v1/a01.mjs` | admitFinal/aggregateActual | Historical A01 repair of missing/duplicate/stale/incomplete/unclean finalization; exact required IDs/nonce/phase, persist raw before assert. New matrix records/own-data/crossrealm inputs require narrow explicit adapter qualification. |
| `tests/commands/xan-module-review-20260828/actual-review-v2/common.mjs` | tree/verifyTree reference | Detects added files and directories but recursion/aggregate size are not bounded and directory modes absent. Cannot substitute unchanged for the bounded source census required here. |
| `scripts/typecheck.mjs`, `scripts/typecheck-inputs.mjs`, `scripts/typecheck-consumers.mjs`, `scripts/typecheck-staged-inputs.mjs` | existing build-first source/test/current-consumer routes | Source/test and exact captured/staged-data classification, real declaration-resolution checks. Top-level runner internally spawns compiler, copies files and cleans its own temp; requires separate supervised developer role, isolated TMPDIR and sealed transitive tooling. Not runtime proof. |
| `scripts/verify-current-consumers.mjs`, `scripts/verify-qualified-release.mjs`, `tests/plugins/qualified-current-release/snapshot.mjs` | qualification and consumer-resolution reference | Full entry points include unrelated runtime/native/staging roles and cannot be run here. Snapshot defaults HEAD, uses native tar, live tooling/inventory and tracked-file-only unchangedTests; NOT an acceptable unchanged admission route. Never call default HEAD, use native engines or claim append-proof checks from it. |

The old `preparation-v2/run.mjs run-candidate` XAN parent has documented A01
missing phase/cleanup integration; do not use it. The array v4 `dispatch.mjs`
hardcodes array authority and requires a stored selectedComposition tree; its
worker expects a staged boundary.mjs that is not a sibling in the live directory.
Neither direct dispatcher reuse nor pretending its authority is generic works.
Reuse the qualified **functions**, with an explicitly reviewed small job adapter;
no new generic supervisor/loader/build framework. All identified gaps remain
BLOCKED until that adapter's actual loaded controls pass before product admission.

## Bounded future sequence (all NOT_RUN)

One attempt, concurrency1, no automatic retries. Proposed harness-only ceiling:
1800000ms total including setup/publication/cleanup; reserve30000ms teardown;
64 developer Git children,32 other tool/type children,48 product workers,144
total spawned children. Each runtime worker <=60000ms, type/build <=180000ms,
Git <=10000ms; cooperative cancellation starts early enough to preserve reserve.
Existing supervisor termination bounds remain unchanged. Old-space256MiB is not
RSS; no performance/timing comparison is planned. Per runtime worker at most
128 invocation rows; total runtime command entries <=4096 across all layouts,
schedule variants and loaded-mutant pairs. Matrix must enumerate the exact lower
number before grant; exceeding a cap blocks, never splits into unbounded retries.

Each physical JSON record <=262144 bytes; capture <=8MiB/runtime worker,
4MiB/type/tool child,1MiB/Git child; total captured<=128MiB, developer Git<=32MiB;
persisted evidence<=192MiB, scratch+artifacts<=512MiB. Byte payloads larger than a
record use numbered base64 fragments <=65536 decoded bytes with sequence/length/
digest and EOF receipt; fsync/close before final. Physical-storage cap needs actual
bounded census and admission on writes, not a final counter. Missing large-source
census/tool closure is a blocker; these ceilings do not raise existing helper caps.
No full repository cohort is authorized by these proposed harness ceilings.

1. **DATA/authority admission.** Check exact finite own-data keys/types/values/
   ordered arrays; reject holes, accessors, symbols/extras and coercible primitives;
   valid cross-realm objects pass without prototype identity. Freeze tool path,
   mode, binary bytes, runtime version, scripts, compiler JS/lib/type closure,
   configuration/lockfile and all helper bytes before any import. Resolve no
   candidate from HEAD. Missing grant or unresolved binding => NOT_RUN, zero
   candidate loads, no candidate staging. Recheck grant/tool/recipe bytes after.
2. **SOURCE binding/build.** Authenticate stored/derived inputs, exact complete
   include/test/helper/consumer inventory and exclusions. Build a NEW owned
   projection from authenticated bytes, no live overlay. Build with already
   installed sealed developer compiler, no product execution. Independently
   census source BEFORE build and AFTER build INCLUDING additions; only the
   enumerated build output directory may gain predicted outputs. Authenticate
   the output JS/declarations/maps and full emitted closure, package metadata
   and import graph BEFORE runtime. Build success alone is not source semantics.
3. **PACKAGE / INSTALLED.** Separate package serialization and actual offline
   install from compiler evidence. Authenticated existing developer packaging
   tool, ignore lifecycle scripts, offline, no audit/fund/network/ambient registry
   or credentials. Package inventory must include exact exports/README/data as
   declared, reject linked/escaping/duplicate/extra members and scripts not
   permitted by the grant. Authenticate tar bytes and every installed byte/mode;
   no synthetic reconstructed tar masquerades as actual pack/install. If only
   verified extraction is granted, label EXTRACTED, not INSTALLED, and keep the
   actual-install requirement NOT_RUN. Before first consumer import, compare
   installed JS/d.ts with emission and re-enumerate both full trees.
4. **MOVED.** Physically move the installed consumer/package to a new exact owned
   directory, record before/after locations/member hashes and original absence.
   No symlink, copy-only or NODE_PATH substitute. Old/source/build locations are
   denied. Re-enumerate package, harness and tools before importing. Record actual
   resolved entry and every returned nextLoad source hash/mode/URL. Run actual
   unchanged cases in fresh processes; do not reuse an import cache across layouts.
5. **TYPES.** SOURCE strict NodeNext source+tests, actual emitted declaration
   positive/negative consumers, installed/moved declaration resolution, and
   maintained exact tracked consumer census are separate profiles. Require real
   compile diagnostics/resolution trace; negatives must fail at intended fields,
   not because import/tsconfig/tooling is missing. No candidate API assumed now.
   Archive/captured/native inputs keep exact authenticated per-file classification;
   every other current TS/helper/consumer is checked or explicitly NOT_RUN. A
   selected consumer compile is not all-input proof. Unrelated failures remain
   failures/blockers; no broad exclusions or test waivers. No default/public
   apply_patch proof until actual root export/registration is independently bound.
6. **SEMANTICS.** Run P01..P32 unchanged plus frozen independent extras through
   actual Shell/registry AND direct context where required. Gate exact stdout,
   stderr predicates/bytes, status or original rejection identity, ordered FS
   calls and complete before/after namespace+bytes before any PASS. All stages
   remain split by Memory/readonly/mount/overlay/rooted Real/injected S3/WebDAV;
   a mock is not a real-service witness. No network or deployed provider here.
7. **LOADED MUTANTS.** Use MUTATIONS-v1.json intent IDs, then separately freeze
   concrete edits, original/transformed source+emission hashes, module URLs,
   marker and trigger witness. Positive-before, ONE targeted mutant, positive-
   after in fresh guarded children. Same exact fixture/checker, no weakened
   expectations. A startup/load78/hash mismatch/nonloaded mutant is NOT a kill.
8. **FINALIZATION.** Persist raw observations before assertions. Ordinary semantic
   failures aggregate only after cleanup/integrity; unsafe child, late ownership,
   output overflow, persistence error, missing finalization or tree drift stops
   dependents. Exact observed required IDs, phase/nonce/layout/input hashes,
   complete/closed flags, process exit/close and retired owned handles must agree.
   Re-enumerate source/build/package/moved/tool/harness trees after EVERY phase and
   final publication, detecting additions/deletions/mode/byte/symlink changes.
   Only declared evidence/output paths may be new. No final PASS from exit0 alone.

## Not-run command templates (not copy/paste authorization)

These are developer tool roles supervised through the existing controller, NOT
virtual command options. Every uppercase token is an UNRESOLVED handoff value;
template expansion must refuse null, default HEAD or an unsealed tool/script.

```text
controller.child('git', PINNED_GIT, ['--no-replace-objects','cat-file','-t',STORED_CANDIDATE_COMMIT], GIT_ROLE)
controller.child('git', PINNED_GIT, ['--no-replace-objects','show',STORED_INPUT_COMMIT + ':' + EXACT_INPUT_PATH], GIT_ROLE)
controller.child('tool', PINNED_NODE, [PINNED_TSC,'-p',OWNED_SOURCE + '/tsconfig.build.json'], BUILD_ROLE)
controller.child('type', PINNED_NODE, [OWNED_SOURCE + '/scripts/typecheck.mjs','--report',NEW_TYPE_REPORT], TYPE_ROLE)
controller.child('type', PINNED_NODE, [PINNED_TSC,'--noEmit','-p',SEALED_LAYOUT_CONSUMER_CONFIG,'--traceResolution'], TYPE_ROLE)
controller.child('tool', PINNED_NODE, [PINNED_NPM_CLI,'pack','--ignore-scripts','--offline','--json','--pack-destination',NEW_PACK_DIR], PACK_ROLE)
controller.child('tool', PINNED_NODE, [PINNED_NPM_CLI,'install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',AUTHENTICATED_LOCAL_TARBALL], INSTALL_ROLE)
controller.child('product', PINNED_NODE, [...SEALED_RUNTIME_GUARD_ARGS,SEALED_APPLY_PATCH_REVIEW_WORKER,SEALED_JOB_PATH,SEALED_JOB_SHA256], RUNTIME_ROLE)
```

BUILD_ROLE cwd is the immutable selected source with only its new dist writable;
TYPE_ROLE has separate owned temp/report/consumer outputs; PACK_ROLE cwd is the
sealed package build; INSTALL_ROLE cwd is a new private consumer with its sealed
minimal package descriptor. Neither npm CLI nor runtime guard args nor review
worker is bound in this preparation: those templates are BLOCKED, not a promise
that copying them works. Existing typecheck internals spawn their own compiler:
admission must account/enroll nested handles or use the same existing compile
functions through a qualified narrow adapter. No unobserved nested process pass.
Source/installed leaf API can be private when declared, but private path import
does not prove bare package/public export support. Existing loader denies bare
imports: an actual package-resolution gate needs a qualified narrow resolver
before the positive public consumer, not a fabricated public specifier.

## Cleanup and output admission obligations

- Root controller owns exact child objects/PIDs/groups created after enrolled
  intent. Worker owns exact Shells, AbortControllers, input iterators, output
  operations, temporary Real roots, gates and worker/lease handles it creates.
  Keep sibling/other-Shell handles distinct. Never kill by name, global process
  census, broad rm, foreign worker zero or guessed PID. Unknown ownership or
  retirement => UNSAFE_STOP, no dependent run and no claim of successful cleanup.
- Register cooperative command cleanup synchronously before input/resource/work
  admission; close admission first, share an idempotent completion across finally,
  runtime drain and repeated dispose. Cover admitted acquisition completing late;
  it must release once. No late new work/invoke. Drain all accepted cleanups even
  when another fails. Direct contexts with no hook still use finally; they do not
  acquire the public Shell barrier by inference.
- Retained stdin fragments must be copied before next/return/finalization mutates
  the producer buffer. Include reused Buffer, byteOffset subarray, split scalar,
  split CRLF, zero chunks, normal EOF and early return mutation. Await every sink
  write; use blocked sink gates to prove no early settlement and exact bytes after
  release, not delay-based assumptions. Transient completed writes need not copy.
- Test abort before args/input, during pending next, after read, at4096 work yield,
  before write, after first mutation and during summary. Propagate original signal
  to every VFS call. Include false,0,null,undefined rejection values and errno-
  shaped cancellation reasons. AbortController.abort(undefined) supplies its own
  default reason: compare the signal's actual reason, not invented undefined.
- Falsy source/sink/provider/cleanup errors retain identity on the direct route;
  Shell mapped errors remain numeric results when appropriate. Root-caller abort
  outranks escaping execution/control failure, which outranks local cancellation;
  preserve runtime provenance, never reason-value equality. Execution rejection
  outranks cleanup-only failure; a sole cleanup failure escapes unchanged,
  multiple cleanups aggregate, even after a numeric nonzero command result.
- readBytes finalizes acquired iterators on early exit, preserves earlier failure
  over return failure and observes late rejection. Opaque uncooperative next,
  return, provider or sink work is not made cooperative by wrapping it. Do not
  await it forever or fabricate preemption; close registered owned admissions,
  release explicit test gates and observe late rejection without revising an
  already selected result. Harness hard-stop is not a product cleanup pass.
- Only final stdout may enroll createOutputOperation; stdout close must not
  cancel sibling stderr/file work or the whole context. Test destination-specific
  closure, explicit child scope drain, unowned wrapper non-enrollment, output
  cap/shared Shell cap and output failure AFTER successful publication. Do not
  roll back files or print a usage diagnostic for a sink exception.
- Freeze partial-effect schedules: first write completed then second EIO; missing
  first parent created then second mkdir fails; Move wx writes prefix then throws
  (source survives); destination succeeds but source revalidation differs (source
  survives); unlink fails (both remain); new target races wx (raced file untouched).
  Every case asserts exact bytes and namespace, including unmentioned sentinels.
  No fault injection may be reclassified as atomic rollback. Overlay housekeeping
  has its own provider effect trace and must not hide a command preflight write.

## Readiness

Preparation can freeze independently of the candidate. Runtime admission cannot:
candidate/root authority, matrix/fixtures, actual API, compiler/package closure,
bounded full-source census, narrow driver/loader/receipt qualification, concrete
loaded mutations and exact per-phase child accounting remain unresolved. Product
execution counts are ZERO. DATA authentication/check results, if run after the
preseal commit, live separately; NOT_RUN obligations never become data passes.
