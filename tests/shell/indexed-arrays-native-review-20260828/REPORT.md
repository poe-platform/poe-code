# Independent ARRAY artifact/design-response audit — August 28, 2026

## Decision boundary

**Qualified historical observations; no implementation freeze or supervisor
certification.** Sixteen planned rows have sixteen matching admission/result/raw
output sets and documented successful top-level spawns. Fourteen exit 0;
N12/N15 exit 127. All record natural direct-child exit/close, null signals and an
absent-group check. These are observations, **not 16/16 PASS**. No concrete
capture-time scope escape, wrong-target deletion, surviving group, or changed
sealed byte is evidenced. Five real static supervisor gaps remain unexercised.
The later document-census stop is real as a recorded artifact outcome, not a
native row failure; its exact command/time lacks an independent execution log.

**Authority correction:** `573f229c:addendum-v2/REPORT.md:31`,
`DECISIONS.md:12` and `BINDINGS.json.rootSettled` describe staged publication and
the literal-index profile as root-settled. The present root instruction expressly
does not fully ratify them. Treat those labels as unsupported author assertions,
not authorization. Only the fresh independent public `Shell.exec` ledger boundary,
shared internal descendants/invoke, and no cross-exec/RSS guarantee are settled
here. The staged-target/no-undo-of-RHS-effects combination and literal-index
first profile require explicit root disposition; GNU output ratifies neither.

This is a **post-observation artifact/design audit**, not a new precode review.
Plato's `0d70a9d4` is the separately bound historical precode review. Applicable
ancestor/root AGENTS were read; no nested instructions were found in the two
reviewed array trees. Only this new sibling sidecar is writable. No author,
product, helper, supervisor, test, build, native script, service or network code
was executed/imported/replayed. Trusted Git/filesystem reads and builtin
hash/JSON/text calculations supplied the checks. No temp fixture or oracle cohort
was created; no STACK retest, XAN work, or broad package acceptance is included.

## Exact bindings and authentication

Short names below resolve to these complete commits. `BINDINGS.json` adds their
root-tree IDs, raw commit/tree SHA256s, scoped tree IDs, key artifact blob IDs and
SHA256s, sixteen selected source blobs, and per-row tuples. Git object IDs were
recomputed from raw object bytes, including the Git type/length header. This
authenticates content, not signed authorship or wall-clock honesty.

| Role | Commit | Recorded commit time, UTC, August 28 |
| --- | --- | --- |
| Faraday original | `2cb939883a91b495bed7dadb8973cd1939b16e6a` | 09:28:14 |
| Faraday addendum/native preseal | `abe53e03b654cd576dfa5f8f7a6cf435edc2b4d0` | 09:43:57 |
| Plato eight-findings review | `0d70a9d4d30f4623a5ec2594e7f8568f5e2dbb43` | 09:58:10 |
| Observation supervisor preseal | `f0c6321f506f866f37c42d4162dc332a80668925` | 10:06:57 |
| Native observations | `4e8f8a13590d489df5b5e7c70fe684de4abd2b5d` | 10:10:44 |
| Prior independent receipt audit | `2142c48314ed252879cd78589870435617358f64` | 10:18:24 |
| Faraday design response/stop | `573f229c5bc60ca92dbcc6ca87e3da3bf9b64634` | 10:19:28 |

The chain has the listed ancestry, with unrelated intervening commits. The
supervisor seal records preparation at 10:06:45.101Z and is committed **before**
recorded admission, not an after-run
seal relabeled pre-execution. AUTHORIZATION preserves a delegated instruction,
not a separately signed GO; its exact manifest/16-row scope agrees with this
task. No authorization for a retry follows from any receipt.

- Native manifest: `native-preseal-v1/MANIFEST.json`, 8667 bytes,
  SHA256 `f731d304306b02d11df41b386d4528405ad307ca33098d25f1bc2a0193c0764f`.
  Its six documents, three preserved originals, sixteen unique scripts and
  null native expectations reconcile; scripts total **1783 UTF-8 bytes**.
- Source composition remains the declared 5137 base + accepted CD + LET, not
  current HEAD. Runtime is `c26892c3a1a419311c9cf46a6c2976e696e00624`, blob
  `9e70a9d556e46ecf23b977a048f089b1c0d25e5c`, SHA256
  `eb4588578001136b8ac011c1c458079b0c8a9f07e653938836d342dff052e193`;
  fifteen other inspected source inputs use
  `5137a74ec855a32d8a8860eb66b62eb44d11e290`. The published 265-input/full846
  package claim is provenance only; this audit does not reconstruct it.
- All **104 unique artifact/provenance files** checked match their specified
  immutable blobs and current file bytes. Separately, all sixteen source
  blobs match declared sizes/hashes/IDs. Current product files were not used as
  source substitutes. Four preseal supervisor/control files also match `f0c6321f`.
- Raw capture `capture-7843e762-7db7-4d2b-a16a-0c279d49c616` has **68 files,
  179841 bytes**, exact committed inventory, tree
  `c3fab31d5ba1bf84fbdd793e9ad2c28a76bd06b9`. Raw inventory digest
  `c47e5066dd14234ee88b047bbbec762a5d187a21b7e9c6d08626c0578fee58ac` and
  status/output tuple digest
  `c954148caef9a01eb1822d131d585b88542f62297a25f55088ca372985e96932`
  independently reconcile with the prior receipt audit; not merely its prose.

All relative artifact references in this report, except the owned sidecar and
explicit Plato/source paths, are beneath
`tests/shell/indexed-arrays-design-20260828` at the named commits.

## Launch, environment and settlement evidence

Pinned Bash path is
`/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, 1395864 bytes,
mode 0755, SHA256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Manual `bash-5.3/doc/bashref.texi` under the same installation root is 415804
bytes, mode 0644, SHA256
`f3d37d57a1061e24d266051de9bd47ffa43dc86584afea11576c535ad2be32d5`.
Committed LET provenance, original preseal, observation pre/post authentication
and per-row binary receipts agree. **This audit did not inspect those external
host paths or freshly hash/run a tool.** N04 raw output also identifies
`BASH_VERSINFO` 5.3.0 and `aarch64-apple-darwin25.4.0`; GNU identity is not inferred
from a filename. Supervisor Node v22.22.2/Darwin25.4.0/arm64 is recorded metadata,
not a newly attested execution-tool binary. No GNU/Linux claim follows.

Every row uses literal argv `--noprofile`, `--norc`, `-c`, the byte-exact sealed
script, `indexed-preseal-v1`. The script slot was compared, not executed. Exactly
eight replacement environment keys agree across seal/admission/result:
`PATH=`, `ENV=`, `BASH_ENV=`, `HOME=<fixture>/home`, `TMPDIR=<fixture>/tmp`,
`LANG=C`, `LC_ALL=C`, `TZ=UTC`. No inherited env merge is present at the spawn
site. Empty ignored stdin, detached child group, `shell:false`, and cwd at the
exclusive 0700 fixture are supported by source plus receipts. PWD/SHLVL/OLDPWD
seen in native listings are shell-created state, not extra supplied env keys.

Recorded fixture root is
`/private/tmp/indexed-arrays-preseal-v1-7843e762-7db7-4d2b-a16a-0c279d49c616`,
device 16777232/inode 181263727; home/tmp are inodes 181263728/181263729. All
three directories record 0700. N15 alone adds `tmp/rhs.txt`, inode 181263803,
mode 0644, nlink 1, exactly five bytes `kept\n`, SHA256
`78051faade059d70866df6a3fb83ef348721fd74a87e93ef95c493f87d0d236b`.
That mode is inside the private directory, not evidence of an outside write.
Peak inventory is four entries. Cleanup records owned file unlink, empty
directory removal and root absence at **10:07:10.137Z**; no broad deletion.
These are historical namespace receipts, not a new filesystem-absence probe.

Sixteen distinct PID=PGID results correspond to sixteen ordered admission slots.
One sequential native spawn site, no retry/version branch, all scripts builtin-
only, and no missing result/output support **sixteen documented actual top-level
launches**, not merely sixteen planned names. N14/N15 each contain one substitution;
18 is a source-derived context allowance, **not a measured descendant count**.
There is no independent system-wide exec/process trace to exclude all unrecorded
processes or certify escaped descendants. PID gaps are not such a count.
This is Bash-call accounting; the supervisor's read-only Git metadata subprocesses
are not additional Bash observations or a measured total-host-process census.

Admission begins **10:07:07.779Z**, direct-child closures span
**10:07:07.820–10:07:08.385Z**, completion is **10:07:10.145Z**. Row intervals sum
201.376081 ms; maximum 18.907584 ms. Every result records spawn, exit, close,
one absent-group check, no stop/error, and no signal sent/received. `childReaped`
is the supervisor's derived `spawnSucceeded && exitObserved`, not an independent
OS wait/reaping attestation. Natural direct-child closure is well-supported;
universal descendant cleanup is not. Captured stdout 3247 + stderr 468 = **3715
bytes**, maximum 568 per row; observed counts equal retained bytes/hashes.
All observed rows are below 3 seconds/65536 bytes; aggregate below 1048576 bytes.
Small natural exits do not demonstrate timeout/overflow enforcement.

## Sixteen observations, without a pass denominator

Every row below has qualified raw-byte/status/closure evidence as described
above. Exit is top-level status, not the status of each builtin. All signals are
null. `out/err` are exact retained byte counts. No row qualifies product behavior.

| Row | PID | Exit; out/err | Exact narrow observation | Still unqualified / policy difference |
| --- | ---: | --- | --- | --- |
| N01 | 69639 | 0; 518/0 | `assignment=0`; declaration and export listing show `-ax`, index 2=`two`. | Proposed exported-scalar conversion refusal differs; no external environment encoding measured. |
| N02 | 69640 | 0; 528/0 | `export=0`; `-ax` retains indices 2=`two`, 9=empty. | Proposed export-array refusal differs; listing is not child exec evidence. |
| N03 | 69641 | 0; 58/83 | `plus_a=1`, cannot-destroy-array diagnostic; array survives; whole unset then scalar yields `declare -- a="scalar"`. | Top-level 0 does not erase builtin failure; product declare support remains excluded. |
| N04 | 69642 | 0; 498/70 | Empty `-ar a=()` before/after; `unset=1`, readonly diagnostic; native readonly list includes version/platform. | Proposed selected-array listing refusal differs; no standalone version call. |
| N05 | 69643 | 0; 79/0 | First local `declare -- a`, then scalar `inner`; `function=7`; sparse outer 2=`outer`, 7=empty restored. | Fresh indexed local proposal differs. Function return 7 is retained, not a row pass. |
| N06 | 69644 | 0; 62/0 | After local unset: `declare -- a`; next write scalar; sparse outer restored. | Initial initialized-local kind is **not inspected** before unset; do not use this row alone to prove it. |
| N07 | 69645 | 0; 78/112 | `local=1`, `initialized=1`; two readonly diagnostics; outer `-ar` unchanged. | Literal operands do not measure effectful declaration argument timing. |
| N08 | 69646 | 0; 540/0 | Exported unset local, then readonly scalar inner; `function=4`; exported scalar outer restored. | Scalar companion, not an independently passing array feature. |
| N09 | 69647 | 0; 48/0 | Final indices 0=`new0`, 1=`old0`, 2=`old2`. | Supports prior-target RHS visibility for this recipe, not concurrency/transaction policy. |
| N10 | 69648 | 0; 48/0 | Final indices 0=`new0`, 2=`old2`, 3=`old0`. | Same limited append visibility; no maximum-index/resource case. |
| N11 | 69649 | 0; 76/103 | `assignment=1 fresh=unset`; old readonly target and `side=before`; both readonly and missing-`fresh` diagnostics. | `side` was already nonempty, so that operand alone proves no suppression. Fresh noncreation is the useful effect observation; scalar timing not tested. |
| N12 | 69650 | 127; 59/50 | Parameter-error diagnostic, no `after`; EXIT inspection shows old indices 0/5 and `side=kept`. | Preserve exit 127 and RHS side effect; not a proposed product status or cancellation result. |
| N13 | 69651 | 0; 44/0 | `assignment=0`; final target only index 1=`rhs-write`. | Historical candidate predicted stale failure1/retained 0+2: contradicted, not passed. Intermediate write/version is not directly traced. Bare-name default support itself is open. |
| N14 | 69652 | 0; 33/0 | Final non-readonly parent array index 0=`replacement`. | Substitution-local readonly, not async parent readonly/reentrancy/cancellation evidence. |
| N15 | 69655 | 127; 38/50 | Old target, `receipt=kept`, parameter error; separately hashed five-byte file survives before cleanup. | No whole-command rollback; no parent-mutation, resource, or cancellation experiment. |
| N16 | 69657 | 0; 540/0 | Function sees exported scalar `temporary`; `command=0`; sparse outer restored. | Proposed scalar-prefix refusal differs; literal RHS cannot settle effectful prefix timing. |

The N13 script's parameter-assignment meaning helps interpret the final bytes;
it does not supply a measured intermediate generation event. Likewise scripts
and source entail what a path does, whereas raw files measure only what was
recorded at their observation points. Unsupported/unobserved neighboring cases
remain unproven, not waived or silently converted to successes.

## The later document-census stop

The original protected root contains exactly `PROFILE.md`, `REPORT.md`,
`SOURCE-BINDING.json`, `addendum-v1`, `native-preseal-v1`. The native supervisor
and later binder explicitly exclude the separately authorized new
`native-observations-v1` and `addendum-v2` trees, but **not**
`observation-review-v1`. Capture preflight/postAuthentication compare equal,
including protected file identities and addition-aware directory census. This
is not an original-path-only postcheck falsely described as append-proof.
Its protection excludes named new trees and is not checkout-wide integrity.

Timeline after capture, all August 28 UTC:

1. EVIDENCE is created at 10:10:30.639 and committed at 10:10:44.
2. The separate receipt audit records start 10:11:07.013 and recheck
   10:15:49.162. Commit `2142c483` at 10:18:24 **adds exactly**
   `observation-review-v1/BINDINGS.json` and `observation-review-v1/REPORT.md`.
3. `FINAL-STOP.json` reports a later `bind-metadata.mjs bind` exit1 at protected
   root census, with added name `observation-review-v1`, missing names empty.
   All sixteen original/review file checks are reported complete; final capture
   inventory, accepted-source and binary/manual rechecks were not reached.
4. `record-stop.mjs` writes a **stopped**, carried-history binding at
   10:19:11.258; response commit `573f229c` at 10:19:28 adds exactly its six
   addendum-v2 files. It does not repair or rerun the binder.

The stop receipt contains no timestamp for the failed attempt or raw captured
stdout/stderr. Its exit1, no contents-read, no retry and zero extra native calls
are author assertions, not independently logged negative facts. However, static
`bind-metadata.mjs:27` checks all protected files before its immediate-child
census, and the committed/current addition necessarily mismatches that census
before later checks. This audit independently finds exactly that added directory,
no missing names, unchanged original/reviewer bytes, and unchanged raw capture.
The precise creation/failure times are not reconstructible from these files.

Thus **a later protected-tree membership mismatch is evidenced**; it prevents
calling the author's final binding a successful final-tree seal. It is not
evidence that the prior sixteen-row capture drifted, violated native scope or
failed cleanup. The added files are a separately reported audit, not a native
fixture effect. Their historical work authorization is not independently signed
here; do not infer a scope violation solely from the census mismatch. No old
file or raw result was replaced. Preserve the stopped result; root must choose
whether to accept qualified historical evidence plus this separate audit, or
hold final-document acceptance. Neither choice authorizes a new execution or
retroactive ignore-list edit.

## Five supervisor gaps: static, not observed incidents

S1–S5 below correspond in order to the prior receipt audit's G1–G5, **not**
Plato's design G1–G8. Anchors refer to the unchanged, precommitted
`native-observations-v1/supervisor.mjs` SHA256
`e52d0f3da4343761b8ce0b3b93ecc3b5a39338829a9b3b993c9b692b09d25194`.

| Gap | Independently verified source consequence | Recorded disposition / remaining limit |
| --- | --- | --- |
| S1, lines 260–288 | Timers signal but never settle an absent close; surviving-group polling has no terminal deadline. A 3s bounded-settlement claim is not implemented for those paths. | All sixteen close naturally far before timers; no hang observed. Timeout/forced-cleanup certification remains unproven. |
| S2, lines 368–388 | Final authenticate omits supervisor/config/authorization, SEAL and external durable ADMITTED; checkReceipts covers raw capture only. Last-row/control-file transient drift can escape final guards. | Current committed hashes agree, and historical preflight authenticates controls; this cannot prove absence of transient last-row drift. Capture protected-doc census is distinct from this hole and the later stop. |
| S3, lines 327–330 | Fixture mkdir precedes identity/ownership registration; a failure in between can leave an acquired unregistered directory. | All three directories are registered in preflight/cleanup; no leaked acquisition is evidenced. Failure-path cleanup is not certified. |
| S4, lines 343–363, 381–382 | Durable row publication precedes rows.push; a post-spawn write failure can undercount launched and falsely label an executed row remaining. | All sixteen full row records/output files exist and reconcile; no such undercount in this capture. ADMITTED blocks ordinary rerun but does not fix accounting. |
| S5, lines 264, 280, 316 | Synchronous spawn throw calls finish, setting childCloseObserved without a close event. Other spawn/reap/group guards still reject it. | Every row records successful spawn and exit, with no errors; fabricated-close failure path not exercised. |

Root may retain these as qualified natural-exit observations without certifying
the supervisor. Future unconditional guard acceptance is not justified; this
audit does not repair it, induce failures, or request another native cohort.

## Plato eight findings versus Faraday response

R below means the bound LET runtime; B means the bound 5137 source, never live
STACK source. **Partial** means specific design questions now have written
answers, not root approval or working implementation. **Unsettled** means an
essential requested mechanism still lacks a closed design. No whole finding is
fully resolved for freeze; the already-settled ledger boundary is not reopened.

| Finding | Concrete response and independent disposition | Exact remaining root choice / required clarification |
| --- | --- | --- |
| G1 publication/index/error phases | **Partial.** DECISIONS G1 specifies exhausted cursor, empty append no-op, explicit reset, unused max+1 allowed, zero fields consume no cursor; malformed syntax2 versus domain/private/refusal1 and existing expansion errors. R:1293/1301 confirms distinct scalar phase. Prior PROFILE sequential-visible writes and new staging are incompatible profiles. | Explicitly choose staged single-target publication versus original sequential writes; if staged, ratify live-prior RHS, no retry, readonly-before-stale precedence, and no undo of RHS effects. Choose canonical 0..2147483647 profile and listed max-index neighbors. Decide whether certain later overflow suppresses **all earlier RHS effects**, while uncertain overflow runs its RHS once before failure. Ratify command-failure1/control behavior rather than importing native127. |
| G2 identity/tombstones/restoration | **Partial.** Watch-owned absent identities retire after the last observer; 64-byte watch plus name/reference/cleanup costs; unique checked generations; save-once frame and restoration reservations. This addresses permanent uncharged tombstones and value-equality ABA conceptually. | Ratify watch cost/ownership and non-reused reserved generations. Require an explicit exhaustion ordering for mutation/version/epoch/restoration reservations relative to G6 counters, including overlays and unset/recreate. Whole mutator coverage is still unproved; root approval cannot turn a proposed version rule into verified ABA prevention. |
| G3 async snapshot consistency | **Partial.** Whole-source epoch, owner pins, reference acquisition before yield, post-await/final guard, fail1 without retry replace assumed mutable-Map stability. Synchronous setters remain synchronous; array arithmetic refuses. R:278 really is a synchronous broad state clone. | Choose conservative refusal when **any relevant source-state mutation**, even unrelated/same-value, occurs during copy, versus withholding that conflict policy. Require exact cloned-field/mutator coverage and scalar snapshot admission/phase before freeze; epoch storage/increments must also be bounded. Native rows cannot decide this policy or prove instrumentation. |
| G4 expression/output ownership | **Unsettled, with useful narrowing.** Existing scalar-compatible materializations stay under existing Budget/owner; new array outputs get tokens before allocation, overlap-aware handoff, UTF-8 pair/lone-surrogate rules and two-vector sorting. R:135/2508/2525 confirms allocations precede setters. | Ratify the explicitly **split** ownership model, not a combined live-memory bound. Require exact owner/transfer/release points for expression, argv and consumer retention. The final flat-JS-string bridge is still absent: choose a documented checkpoint exception/claim narrowing or require a bounded mechanical bridge before freezing the profile. Do not assert preallocation/checkpoints just from a reservation. |
| G5 cleanup/work schedule | **Unsettled, with one concrete repair.** A slot now reserves visit+delete+release and its reference decrement (four units); object release has its own reserve, no refunds; queue storage pre-admitted; dependency-safe refcounts, not LIFO; synchronous restoration before detached release. B cleanup.ts:46 indeed drains concurrently. | Ratify the additive release schedule and shared cross-helper work counter. Resolve the same flat-string checkpoint boundary as G4; define dependency/queue ownership mechanically before claiming exact every128-unit yielding or no-fail restoration. No new cancellable admission in restoration, no opaque-host preemption. |
| G6 caps/error/recovery | **Partial.** Lazy exact arithmetic, fixed cap-check order, private diagnostic failure1 in both profiles, ordinary surrounding control, continued scalar commands, no cumulative refunds; diagnostics use existing output path and preserve its failure precedence. Fresh exec/shared descendant boundary is already settled. | Ratify caps F/F/B/128F/8B+512F/8F/32B+256F and their refusal order; choose ordinary failure1 rather than assignment Flow/new ShellLimitError, including diagnostic delivery failure precedence. Accept early low-cap refusal explicitly. Old allocation example is coherent for listed v1 objects, **not a complete v2 peak** including watchers/pins/queue/restoration reserves. Require that narrower accounting statement, not a capacity promise. |
| G7 scalar bridges/attributes/phases | **Partial.** Exact 13-name refusal list, exported-unset rule, no array env serialization, full child/overlay snapshots, selected-only listing refusal2; command-word/RHS/input/scanner effects precede respective refusals/writes. R:1379/2331 supports scalar projection and listing selection. | Choose intentional differences: exported scalar/unset conversion refusal; export-array refusal; scalar-prefix refusal1 **after RHS timing**; typed empty/zero local shadow rather than GNU N05 scalar local; selected-array listing refusal2/no stdout. Ratify read/getopts/for zero-write effect phases, and complete-env validation before shadows. Keep scalar-only compatibility and exact replaceEnv; no DIRSTACK inference from old source. |
| G8 grammar/operators/field composition | **Partial, not fixture-ready.** Whole bare/single/double-quoted canonical digit token; no concatenated fragments/dynamic/arithmetic indices; exact read forms; excludes bare and bracket array arithmetic, presence/indirection/slicing/array operators; scalar operators unchanged. Single aggregate and IFS rules are specified. | Ratify literal grammar/domain first. Choose blanket indexed default/pattern/substring/assignment-operator refusal **or** an explicit bare-name carveout; N13's old candidate assumes the latter and is not approved by observation. Specify failure class/phase for runtime kind-dependent refusal before an alternate RHS. Resolve repeated aggregate fragments and absent/missing/empty composition before expected fixtures; preserve scalar forms. |

The 13 proposed conversion refusals are exactly PATH, PWD, OLDPWD, HOME, CDPATH,
IFS, OPTIND, OPTERR, OPTARG, REPLY, LANG, LC_ALL, LC_CTYPE. No blanket LC rule or
invented special-variable behavior follows. Declaration-a/typeset/mapfile/
readarray remain excluded future stages, not passing placeholder features.

Additional contradictions requiring narrow disposition, not new experiments:

- G1's `a+=()` says no mutation/version advance; G2 says every watched successful
  mutation, including same-value writes, advances. State whether an effectful
  append that ultimately yields zero fields also skips publication/version, and
  whether empty append still validates a concurrently changed/readonly target.
  Empty syntax and zero-field RHS are not interchangeable evidence.
- G6 repeats the v1 empty-array metadata160 example; new G2/G3/G5 ownership adds
  costs. The example can remain a historical/lower-bound illustration, not the
  exact admission cost of the new design. Reservation order must include identity
  and epoch exhaustion, not only the seven storage/work caps.
- G8's blanket indexed-operator exclusion contradicts the old N13 candidate;
  the author acknowledges this correctly. A runtime refusal is needed for
  `${a:=...}` when a is indexed without banning the same syntax for actual
  scalars. Its exact status/effect phase is not supplied merely by saying
  “excluded.” Repeated aggregates are explicitly left open.

## Root handoff and remaining limits

Root decisions are the concrete alternatives/ratifications in the eight-row
mapping plus the final-document disposition above. First remove the mistaken
ratification inference; then choose the staged/literal profile, intentional
GNU differences, conflict/error policy and accounting claim boundary. G3–G5
mechanical gaps still require design closure even if policy direction is chosen.
This audit supplies no implementation advice as a substitute for those choices.

Preserve all nonzero builtin/row outcomes, the N13 candidate contradiction,
five unexercised guard gaps and STOPPED_FINAL_INTEGRITY. There is no missing
authorized row in the durable capture, but no independent process telemetry,
negative guard exercise, fresh tool attestation, precise stop transcript,
resource/RSS measurement, product run, or current full gate. This sidecar does
not amend any old artifact or turn a later check into a precode/preseal check.
The bounded review ends with this report and compact binding data only.
