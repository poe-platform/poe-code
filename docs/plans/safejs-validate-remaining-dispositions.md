# Independent validation: remaining SafeJS functional dispositions

## Verdict and exact scope

**READY FOR PUBLISHER REFERENCE — disposition review only, as of base ecfd838a.** No required semantic correction to Hilbert's frozen disposition mapping was found. This approves neither 47 bug closures nor a current/future integrated release. The six documentation gaps, five targeted validation tasks, sixteen ranked/unranked open rows, G01, and supplemental functional companions remain actionable.

- Reviewer: delegated independent worker Noether; author Hilbert is closed. August 29, 2026.
- Workspace: /Users/kjopek/Workspace/poe-code-safejs-remaining-dispositions.
- Immutable reference root: `out/safejs-remediation/remaining-dispositions-validation/candidate-20260829-ecfd838a-noether-dispositions/`; `evidence/` paths below are relative to that capture.
- Requested and actual reviewed HEAD: ecfd838abd37fb061d66dc8721bc3f86067139ad. No pull, fetch, commit, push, branch, index, or worktree source mutation was needed or performed.
- Frozen author plan: docs/plans/safejs-remaining-functional-dispositions.md; SHA-256 be722d95abe907999b54388bfb46d70f9a8446bd593533277a528b44b22ec163. It remains byte-identical.
- Only this validator plan and its owned output directory are written. Production, tests, README, Hilbert's plan, publisher ledger, other clones, and original audit remain untouched by this review.
- This is a Markdown QA/disposition plan. Recorded inline command inputs in JSON evidence are receipts, not a new executable QA runner.

## Census and complete mapping

The 47 scope rows are 21 ranked groups / 23 ranked IDs, two unranked findings, three historical documentation rows, and 21 observations. G01 is additional and must not disappear into those counts.

| Disposition class                                        | Rows |
| -------------------------------------------------------- | ---: |
| Published as of pinned base, historical receipts checked |    7 |
| Open ranked/unranked findings                            |   16 |
| Documentation gaps                                       |    6 |
| Targeted validation asks                                 |    5 |
| Qualified/control/coverage/history                       |   13 |
| Total scope rows, not bug count                          |   47 |

The thirteen consist of three resolved-qualified, four nonbug controls, three coverage gaps, one bounded completion, one historical repair, and one attribution row. None is permission to discard a historic result.

Independent inventory reconciliation checks every ID, duplicate, destination and inventory pointer: **128/128 FAIL, 17/17 unresolved, 30/30 review-only configurations, 93 review-only children**, with zero missing/extra IDs, duplicate IDs, incorrect FAIL/unresolved pointers, invalid destinations, or changed review-only classifications. All 21 ranked groups and all 23 ranked IDs match currentPriorityOrderingV12. Original active-functional totals remain **628 = 412 PASS + 128 FAIL + 27 expected-rejection + 44 unsupported + 17 unresolved**. These are historical labels, not current pass rates. Full row-by-row source metadata and mappings are in evidence/reconciliation.json.

| Row | Identity                                                          | Independent disposition                                                                                 |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| R01 | COLL-001                                                          | Accept as-of-base receipt; no live-method or test-typing closure.                                       |
| R02 | ARRAY-OWN-METADATA (STR-01, NUM-002)                              | Keep open at this base; metadata checkpoint and regex order are separate.                               |
| R03 | OBJ-001                                                           | Accept scoped alias fix receipt; not iterable or sparse-clone parity.                                   |
| R04 | SOURCE-EXCEPTION-COERCION (AW-001, AW-002)                        | Keep open: fresh [false,undefined] versus [true,"RETRY"].                                               |
| R05 | MC-003                                                            | Accept numeric-constant receipt; MC-002 remains open.                                                   |
| R06 | RETAINED-CALLBACK-DELIVERY (CBI-001)                              | Keep open; candidate is not integration or O05/O12–O14 proof.                                           |
| R07 | NUM-001                                                           | Keep open: fresh undefined arity versus 2; not callable writes.                                         |
| R08 | OBJ-002                                                           | Keep open: fresh sparse clone throws; named metadata/raw also pending.                                  |
| R09 | AR-001                                                            | Keep open: ordinary-host capture rejects reentry; AR-002 timing is separate.                            |
| R10 | PPR-002                                                           | Keep open: fresh raw completed replay references missing work.                                          |
| R11 | STR-03                                                            | Accept replacement-only receipt; no metadata/cursor/split/order closure.                                |
| R12 | STR-04                                                            | Keep open: fresh matchAll cursor count 2 versus 1.                                                      |
| R13 | LANG-01                                                           | Keep open: fresh nested read-only reduce rejects versus 6.                                              |
| R14 | CONTEXTUAL-FROM (TREE-01)                                         | Accept contextual-from receipt; keyword return/async computed remain open.                              |
| R15 | OBJ-003                                                           | Keep open: fresh Map input to fromEntries throws versus {value:7}.                                      |
| R16 | MC-001                                                            | Accept lint receipt; corpus graph still maps MC-002, harness review maps MC-001.                        |
| R17 | STR-02                                                            | Keep open: fresh [] versus null for global no-match.                                                    |
| R18 | STR-05                                                            | Keep open; scoped split candidate is not merged-base certification.                                     |
| R19 | HI-002                                                            | Accept offset-only receipt; not HI-001 or full generator capture parity.                                |
| R20 | CTX-001                                                           | Keep open: fresh supplied-thisArg throws versus [8,12].                                                 |
| R21 | MC-002                                                            | Keep open; derived namespace identity contract is not waived.                                           |
| U01 | PPR-001                                                           | Keep open: original raw public Promise aliases fail all four fresh comparisons.                         |
| U02 | IP-002                                                            | Keep open: native 7, parser rejects return method; async computed companion too.                        |
| D01 | HI-001                                                            | Accept only obsolete nested-await restriction closure; 7/lint clean twice, installed copy agrees.       |
| D02 | AR-002                                                            | Accept next-yield contract distinction, not deadlock or AR-001 repair.                                  |
| D03 | AR-003                                                            | Keep actionable source-generator documentation drift; fresh suspended replay [1,2].                     |
| O01 | MUTATION-GUARD; COLL-002; LANG-02                                 | Keep documentation/compatibility decision open; structural mutation refuses, read-only defect separate. |
| O02 | EAGER-ENUMERATION                                                 | Accept explicitly documented eager arrays only; do not waive default for-of.                            |
| O03 | REGEX-SUBSET                                                      | Keep u/y documentation decision open; named regex exclusions remain controls.                           |
| O04 | LINT-RUNTIME; LINT-01                                             | Accept obsolete switch policy closure only; fresh 7 and clean lint twice.                               |
| O05 | ASYNC-PROOF-FIXTURES                                              | Keep targeted external-proof function semantics open; ordinary-return proof is narrower.                |
| O06 | PREWRAPPED-REPLAY-CORRECTION                                      | Accept corrected prewrapped expectation; call totals 1 ordinary / 2 prewrapped.                         |
| O07 | RUN-RESULT-SHAPE-DOC; SCHEMA-API-002                              | Keep public two-channel error documentation open; no invented always-resolve guarantee.                 |
| O08 | NUM-003; DECIMAL-CALLABLE-CUSTOMIZATION                           | Keep callable-write subset documentation open; not arithmetic or arity closure.                         |
| O09 | BINARY-IN; TREE-02; SCHEMA-IN-001                                 | Keep explicit in-operator documentation open; lint accepts, runtime rejects.                            |
| O10 | CANCEL-OBS-01                                                     | Keep live binding-view contract open: 0→1; serialized 0, resumed 1.                                     |
| O11 | EDITOR-ORIGINAL-EXPECTATIONS                                      | Accept obsolete constructor-policy qualification only; C4 remains O07, no whole editor rerun.           |
| O12 | INPUT-ERROR-PROJECTION                                            | Keep complete-versus-minimal Error proof validation open; AW is not this witness.                       |
| O13 | RAW-PROMISE-PENDING-WATCHDOGS                                     | Keep all four profiles/eight watchdogs unresolved; fresh capture blocks restore.                        |
| O14 | ADAPTER-CHAIN-LIFECYCLE                                           | Keep four full workflows pending; fifth historical case has narrower fresh settled-capture proof.       |
| O15 | RANDOM-TIME-NATIVE-PREFLIGHT                                      | Retain two native-only preflights; no SafeJS PASS or invented bug.                                      |
| O16 | INDEXED-DEADLINE-INCOMPLETE                                       | Accept bounded missing-completion resolution only; full output/logs match, old deadlines retained.      |
| O17 | CAMERA-TYPED-NATIVE-ONLY                                          | Retain three typed-native-only configurations and unexecuted acosh.                                     |
| O18 | COVERAGE-CAPTURE-LIMITS                                           | Retain missing fragments, synthetic CTX scope, invalid drivers and partial-output limits.               |
| O19 | IV5-01; IV9-01; IV10-01; SOURCE-MAP-COMMAND/PLAN-LOCATION REPAIRS | Accept historical metadata repairs only; all 30 IDs/93 children verified, no new runtime credit.        |
| O20 | EXPECTED-ERROR-CONTROLS                                           | Retain historical refusal/unsupported controls; selected cyclic error confirmed, O13 not a refusal.     |
| O21 | HISTORICAL-POLICY/PROVENANCE-ATTRIBUTION                          | Retain attribution/cutoff limits; delegated worker policy does not rewrite historical claims.           |

The multi-cause template replacement case remains R02+R11; module graph cases retain MC-002 even where MC-003 or harness-only MC-001 is repaired. Alias labels DP-1/LA-01/PDR-01, DP-2, CPC-01, IP-001/LA-L1 and PDR-02 retain their author destinations. D01's eight direct/SDK associations remain historical evidence, not eight newly rerun SDK workflows. O14 retains all five historical FAIL IDs: the single-input control does not close the four full cases.

## Contract adjudication

Public anchors inspected at this exact source hash include README:135 (nested await, switch, ordinary functions, generators), README:144 and :330 (overbroad suspended-generator prohibition), README:165 (method coverage), README:265–268 (resolved run-result shapes), README:274 (dump requests next yield), README:331 (regex exclusions), tracked skill:80–111, CHECKPOINT_REPLAY:65–75 (source identity/reconstruction versus opaque codec), and :110–145 (matching external proofs and callback disposition).

The installed /Users/kjopek/.agents/skills/poe-code-safejs/SKILL.md matches the tracked template SHA-256 11b5f28a9efa75f35545bcc9ef02bb83964a22485224fe7934a440101d1bb973. No claim covers every other installed skill. Implementation branches demonstrate restrictions but do not substitute for public documentation: interpreter.ts:2980 deliberately rejects binary in; :3279 refuses source-callable property assignment. Therefore O08/O09 stay documentation/compatibility tasks, not silently documented nonbugs.

D01 is a scoped obsolete-policy closure: nested await returns 7 with no lint diagnostics twice, and current guidance agrees. D02 is a timing distinction supported by snapshot/dump.ts:93/:109/:196/:223 and README:274. The public package index exports dump, not dumpCurrent; both ordinary-host capture paths still fail AR-001. A held next-yield request is not a deadlock. D03 is a real documentation gap: suspended source-generator replay succeeds, but no arbitrary opaque host iterator/frame serialization is certified.

## G01 remains an open functional issue

G01 is not a security investigation, not an ARRAYOWN regression verdict, and not closed because an earlier base also fails. The same ordinary enumerable host getter witness gives native **[10,[receiver,key,get,argument,call],100]**; low-level interpret gives **-1 with 32 getter reads** twice. Optional null returns undefined without argument evaluation but causes **31 reads** twice. Nonenumerable low-level controls match native value/order with one read. Full traces are retained in evidence/getter-boundaries.json.

The measured public raw-binding run, deepCopyToSandbox and ordinary host-result boundaries refuse enumerable accessors with TypeError before invocation (zero getter reads). Nonenumerable input fields are omitted, not publicly supported getters. This is a precise claim about those paths, not an untested universal statement about every embedding arrangement.

Root pointers: interp/values.ts:380/:436 uses Object.entries during graph measurement; :881/:894 uses descriptors and rejects enumerable accessors during public copying. The existing values.test.ts:421 asserts zero-invocation refusal. SandboxObject's index signature at values.ts:46 and InterpretOptions at interpreter.ts:195 do not encode a descriptor invariant. interpret is not exported by index.ts/core.ts/package exports. Consequently arbitrary raw accessors are not established public input support, but a legitimate internal bookkeeping invariant still needs ownership: measurement must not silently execute input behavior before source evaluation.

**Bounded G01 next task:** the internal value/embedding owner must choose and enforce either descriptor-aware side-effect-free measurement for the existing witness, or deterministic accessor rejection at the internal normalization boundary before any getter call. Retain exactly the callable/optional enumerable and nonenumerable controls, ordinary data/function behavior, source receiver/key/argument order, and all three public zero-read refusals. State the internal SandboxValue descriptor invariant and public boundary restriction explicitly. Do not implement guest getter syntax or add adversarial probes. This additional issue is not one of the six counted documentation gaps and remains pending after this approval.

## Six exact documentation tasks

These are bounded owner handoffs, not authorization to edit README here. A documentation owner needs the user's normal README permission. Where a change would expand compatibility rather than describe an intentional limit, obtain a separate semantic task; documentation cannot retroactively waive the derived contract concern.

1. **D03 / AR-003:** reconcile README:144/:330, tracked skill:111, and CHECKPOINT_REPLAY:65–75. Distinguish reconstructed synchronous source-generator state from opaque host iterator/frame serialization. Include the measured source generator yielding 1, awaiting a prewrapped finite gate, then yielding 2; first and restored results [1,2]. Preserve AR-001 ordinary-host capture caveat and the opaque codec limit. Acceptance: the three documents no longer categorically contradict the supported example; no broader host-generator promise.
2. **O01 / COLL-002 / LANG-02:** qualify README:165 and the corresponding skill method guidance for structural mutation of a receiver inside Map.forEach / array.reduce callbacks. Use only the two current mutation witnesses and a nonmutating control; preserve direct for-of COLL-001 and read-only LANG-01 distinctions. Acceptance: affected callback/receiver limit and current reentry behavior are explicit, and no guard deletion is implied. A decision to support these mutations requires a separate validated runtime task.
3. **O03 / REGEX-SUBSET:** at README:331 and matching skill regex guidance, list actual supported flags after checking interp/regex/parse.ts:367, separately from unsupported syntax. Retain exact IDs strings:c01-marked-lookaround, c02-marked-backreference, c03-named-group, c04-minimatch-unicode-property, c05-unicode-flag, c06-sticky-flag and their existing strings/reductions paths. Acceptance: c05/c06 u/y refusal has an explicit compatibility decision; Unicode property escape wording is not misused as a flag specification. No engine feature expansion or budget/security cases.
4. **O07 / SCHEMA-API-002:** amend run API guidance at README:265–268 with one caller example handling both rejected application/API errors and resolved ok:false interpreter errors. Use the existing three ordinary throw shapes plus top/closure/await in-operator shapes. Acceptance: ordinary throws reject; unsupported top/await resolves ok:false while closure rejects on this base; the example handles both without claiming universal shape invariance. O11 C4 points here.
5. **O08 / NUM-003 / DECIMAL-CALLABLE-CUSTOMIZATION:** name the source-callable own-property write restriction in the public subset/skill guidance. Show configured.option=3 currently throws versus native 3 and retain historical histogram/d3/custom-string evidence references. Acceptance: scope excludes NUM-001 arity and captured callable property-data preservation; no arithmetic defect or whole decimal workflow PASS is invented.
6. **O09 / TREE-02 / SCHEMA-IN-001:** explicitly document binary in as unsupported and its lint-versus-run channel qualification, linked to O07's caller handling. Acceptance: lint acceptance is not advertised runtime support; own-only Object.hasOwn rewrite is labeled own-only, never a general prototype-bearing equivalent. No operator implementation in this documentation task.

## Five exact targeted validation tasks

Shared protocol: use a freshly captured checkpoint on the explicitly integrated prerequisite tree, native expected first, then the exact original source/fixture with unchanged version markers; run each specified profile twice with finite original operation schedules and explicit cleanup. Preserve every prior failure/watchdog. Use in-memory fake capabilities/backend only; no guest filesystem, network, processes or LLM. Every future original input must pass a newly restored 38-path-plus-security guard and a concrete allowlist. A prerequisite is not a claim of shared root cause.

1. **O05 / ASYNC-PROOF-FIXTURES:** after applicable AR/PPR/CBI integration, use async-replay/results.json#/schedulerBoundaries/1 (callback-external, examples/05-callback-checkpoint.js), #/correctedBoundaries/0 and /1 (retry-reissue/retry-external, examples/06-pending-retry-map.js), and /3 (callback-external-data, examples/09-callback-data-proof.js). Preserve the corrected gate/proof ordering. Compare complete results, callback/request IDs, source function identity, joined/detached disposition, native call suffix, and trace. Distinguish returning the reconstructed function in an external proof from invoking a callback adapter (which starts new work per CHECKPOINT_REPLAY:134). Acceptance: exact valid proofs and data-only controls match without repeated completed calls; unsupported function-proof representation must receive an explicit contract/functional disposition, not be inferred from ordinary relay success.
2. **O10 / CANCEL-OBS-01:** six original IDs cancellation-replay:map::two-workers, map::verify, graph::computed, graph::review, scan::replacement, scan::unseeded-fold at inventory cases393/394/396/397/399/400. Sources are cancellation-replay/01-bounded-map.ajs, 02-dijkstra-heap.ajs, 03-scan-reduce.ajs. At the same cancellation boundary retain backend's live bindings, serialized binding/heap/replay/input graph, cleanup trace, and fresh serialized resume. Acceptance: separate a changing diagnostic view from persisted checkpoint corruption; either detach a promised point-in-time view or document its live nature without weakening serialized correctness. Two repetitions of six profiles are a bounded new check, not a claim that the old 24 resumes were rerun.
3. **O12 / INPUT-ERROR-PROJECTION:** exact input-promise-recovery:reject-right-first using 01-input-batch-scan.ajs, expectations.json#/profiles/1, representation-assessment.json and results.json after applicable input replay integration. For the same fresh capture/request, compare the full modeled Error including captured stack/identity graph against the deliberately reduced name/message projection. Preserve call ID/source hash/module/operation/argument digest, rejection identity, source trace and consumption state. Acceptance: full valid proof restores the captured outcome; minimal projection gets its own observed classification. A valid-proof identity failure stays a separate functional issue; neither AW failure nor an internal prewrapped Promise control establishes raw public input parity.
4. **O13 / RAW-PROMISE-PENDING-WATCHDOGS:** exact four IDs public-promise-recovery:pending-after-left-held-proofs, pending-after-left-immediate-proofs, pending-both-pending-immediate-proofs, pending-missing-provider, using public-promise-recovery/01-public-input-scan.ajs and existing recovery/review results profiles after AR/PPR integration. Obtain the required pending capture before attempting restore. Assert exact held/immediate proof schedules, matching request identifiers, consumption/lifecycle and native call suffix; observe actual missing-provider behavior. Acceptance: capture, provider invocation and restored completion/refusal are separately reported. A watchdog or empty request log cannot stand for successful refusal or consumed proof. Keep all eight historical watchdogs unresolved until this exact task completes.
5. **O14 / ADAPTER-CHAIN-LIFECYCLE:** the remaining four IDs are public-promise-adaptation:full-prefulfilled-after-left-restore (cases650), full-prefulfilled-both-pending-restore (651), public-promise-chain:prefulfilled-resume-a (657), prefulfilled-resume-b (659). Sources: each family's 01-public-input-scan.ajs. Revalidate after applicable AR/PPR/CBI integration with exact workflow aliases/mutations/closures, traces/call suffixes and lifecycle transitions; compare uninterrupted native/current plus fresh replay at each named boundary. Acceptance: full result and journal state, including all expected consumed anchors, agree. Keep all historical twelve qualified children/eight chain lifecycle differences. The fifth ID public-promise-adaptation:single-completed-restore (653) retains its historical FAIL label and current narrow [settled capture → consumed replay, {value:7,sameHandle:true}] control; it is not counted among the four unfinished full workflows. Do not relabel historical jobs-v1 bytes as current jobs-v6.

## Other pending companions

- **Named array metadata/raw checkpoint loss:** remains R08 / OBJ-002, not R02 live-property repair. Existing graph witness shares one metadata object among rows[0], rows.metadata, rows.raw, separate metadata root and ordinary-object metadata/raw fields, with alias root equal to rows. Expected own keys [0,metadata,raw] and all shared aliases; unmerged representation loses named keys/aliases to [0]. Require exact graph/keys/alias proof after OBJ002 integration, with holes versus undefined, length, cycles and supported legacy representations. This task ran no new companion campaign and does not certify its integration.
- **Regex own-key order:** keep expected [0,1,index,input,groups] versus [0,1,groups,index,input] pending after ARRAY integration. Replacement STR-03 receipt is not a key-order repair. Reuse the existing original regex result witness; no unrelated regex expansion.
- **Async computed object method:** native 7, current ParseError at 1:24 twice. Retain as U02 companion rather than TREE-01 closure.
- **COLL supplemental typing:** remains separate ownership/candidate work. This review neither edits those tests nor waives their diagnostics.

## Independent commands and full outputs

Seven bounded runtime commands used node --import tsx --input-type=module with stdin, working directory this clone. The first six reproduce the reviewed inline author blocks byte-for-byte (including matching stdin hashes for the first five). The source-function block uses the actual appended recipe, whose stdin SHA differs from the earlier historical receipt; it is not relabeled as that receipt. The seventh injects already guard-read exact radix source/fixture literals into the author's finite recipe and adds full output/log recording; guest source bytes and fixtures are unchanged. Three embedded originals were independently compared through TypeScript string-literal parsing: external dump, Promise alias and single-input adaptation all match original bytes exactly.

| Independent command receipt | Exit | Records | Elapsed ms |
| --------------------------- | ---: | ------: | ---------: |
| public-controls             |    0 |      58 |        875 |
| getter-boundaries           |    0 |      10 |        636 |
| checkpoint-timing           |    0 |       7 |        668 |
| original-alias-embedded     |    0 |       4 |        561 |
| cancellation-lifecycle      |    0 |       4 |        583 |
| source-function-replay      |    0 |       2 |        563 |
| original-radix-bounded      |    0 |       1 |       9842 |

Total: **86 observational records, seven exit-0 helpers, 49/49 explicit disposition/repeat assertions**. Exit 0 and passing disposition assertions do not mean all semantic outcomes match native: open issues deliberately remain red. No package/full test, build, typecheck or lint suite was rerun for this documentation-only review; no new code or test file exists. No all-commands-green claim is made.

- Public controls: 29 configurations × two repeats = 58; complete native/current values, errors and lint diagnostics in evidence/public-controls.json. All repeated comparisons are identical.
- G01: eight repeat/enumerability/optional records plus two public boundary controls = ten; exact traces retained.
- Checkpoint timing: seven records including plain/prewrapped timing, one-versus-two calls, source generator, raw completed rejection and adapted control.
- Original alias: four records; expected promiseAlias/sameHandle/sameAlias/markerVisible all true with value7; actual promiseAlias/sameAlias/markerVisible false, sameHandle true, value7 in both bindings and entryPointArgs twice.
- Cancellation/lifecycle: four records, including two O13 branches blocked before restored replay. The mirrored resumed error field is explicitly a capture error, not a restore attempt. Live cleanup0→1, serialized0, replay1; single settled capture resumes to consumed with value7/sameHandle true and four automatic captures.
- Ordinary returned source function: two first/replay comparisons [true,7], one total native relay call each; not external function-bearing proof support.
- Exact radix diagnostic: one finite 15-second-budget current run, 22-second outer bound, 1-second native vm bound. Full native/current output and all 167 log entries match; 12 semantic snapshots, 12 structure snapshots, 125 trace events, output SHA-256 1e1738cb9d715a74031f787212557d922e69396777339b90f3ca1e95c68c5856. Reported nodeVisits4 is literal, not full-operation coverage. The 9,842ms helper duration is not a benchmark/SLA. Author's two 3-second failures and older incomplete attempts remain recorded.

### Preserved helper failures and qualifications

Hilbert's original native-adapter semicolon/missing-structuredClone setup failures, synchronous dump catcher failure, invalid read policy, tautological old serializedStable field, blocked O13 branches, and two incomplete short radix runs remain untouched in the frozen author plan:375. They are not product passes.

This review retained two failed metadata assertions, both corrected without source changes: a raw textual JSON-escaped substring comparison miscompared the single-quoted external-dump source literal (corrected by TypeScript AST extraction; exact bytes match), and the companion hash checker selected the first narrative pointer instead of the manifest table row (restricted to table rows; all four hashes match). One static rg invocation initially included nonexistent packages/safejs/src/regex; its diagnostic is retained and the actual interp/regex path was located locally. No product failure was hidden by these corrections. The C-LANG readiness file intentionally indexes another manifest: its own SHA is df0252cfa15e97fec17797152efa2cf4c951bdaaae456ed4bc098ade90e37343; the indexed manifest matches the advertised 974b81a0571149eeef492b558a27654ffd7e5a8c8ba163012b933e40789fecc3. This is not an author hash defect.

## Audit guard and read accounting

Before any original functional payload, bootstrap inventory-verification.json was read as policy metadata, SHA-256 2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827. archiveReadPolicy.excludedPaths supplied **38 exact exclusions**; ordered-list SHA-256 31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13. Entire security/ and dynamic-deflate-provenance-review/ were also denied. Every original functional read required concrete allowlist membership, normalized relative containment and deny checks. No audit discovery, recursive search, excluded payload read/hash/execution, or security research occurred.

**Nine distinct allowed historical functional audit inputs plus one bootstrap metadata file were read. Zero excluded security payloads were read or hashed.** Use this terminology, not “all archive bytes reverified.” Metadata mentions of excluded paths are not payload access; older inventory-review deviations are historical records, not this review's activity.

| Allowed functional input                                      |   Bytes | SHA-256                                                          |
| ------------------------------------------------------------- | ------: | ---------------------------------------------------------------- |
| inventory.json                                                | 6985302 | 00ca8535d28a90d9bc0810090db149a91491a6ed1048d8e55c75fa7d3f78a822 |
| REPORT.md                                                     |  123173 | 40d467e72bd741dfeaa5c6b776c3d2cc7dc61d622e0e08419c05506c2c428fb1 |
| SNIPPETS.md                                                   |  326612 | b4b9808508100bbe836792e11e9e2d8ee7fc4ace10b6650ae6ee5704e8b5fb41 |
| async-replay/reductions/10-external-dump.js                   |      96 | 7ca76d186abe3c3245fe811d7652e7d4d04cd528c47f401555543cd4eb038af3 |
| public-promise-recovery/02-public-promise-alias-control.ajs   |     449 | 784f6eb021150c6c0d83365061cea4db1cc53d2504e643900aff633d178347be |
| public-promise-adaptation/03-single-public-input-recovery.ajs |     207 | 21004b9bd197084cdfc54b678a69094d9fc2ca776710fd773f57c6bef753c1a8 |
| indexed-structures/cases/radix-progress.ajs                   |    9655 | 323143410a42633f9943b303444b42a9fa1828d9df6ab0e6c422a761604c8f0a |
| indexed-structures/fixtures.json                              |   11826 | fa6aa4711216f683d9e2b6b7de6bd291fe677573545f15037deb0d478c32b039 |
| async-replay/results.json                                     | 1610507 | b47e38034682df7f5a3f0167ee734e7f3a00850ef6755092a7782b05492d3ce1 |

## Receipt scope and publisher handoff

All 23 author-listed tracked source/docs hashes match both current files and git show HEAD preimages. All ten candidate references resolve: nine direct manifest hashes and the explicitly indexed C-LANG manifest. Four old getter companion evidence hashes match. These checks confirm receipt identity, not revalidation of every candidate or its later integration.

Seven pinned-base release records were independently read at ../poe-code-safejs-publish/out/safejs-remediation/releases/{mc-003,mc-001,str-03,coll-001,tree-01,hi-002,obj-001}/result.json. Each recorded completed Release/Pages success, tag commit and npm gitHead agrees with its commit, and git merge-base --is-ancestor confirms all seven commits are ancestors of this reviewed HEAD. Versions11.0.2–11.0.8 are historical receipt facts. No remote registry/GitHub query, current latest claim, new release approval, or future integrated-gate certification is made.

The read-only publisher ledger has advanced since Hilbert's capture: observed SHA-256 fad09b95a7abebdce93e1ad85a10217b4df3603e977b6b0b28d69286ba0033a0 versus author's e86c0278562bb25331122eee0e7f18abbb392019a516009d49a9f1c23db25b59. It reports newer ARRAY/typing activity. This review does not verify that newer publication, overwrite its statuses, or pretend the as-of-base seven count is current. No pull is appropriate for adjudicating the explicitly frozen base. Kuhn alone reconciles later receipts into the master ledger and performs required intake/integrated gates.

### Freeze and acceptance

The immutable reference candidate contains exactly the two plans at their repository-relative paths plus validator evidence. Both plans are absent at reviewed HEAD, so both base preimages are absent, not empty-file hashes. The author input hash is retained separately from that absent Git preimage. Manifest entries pin relative paths, byte counts, SHA-256 and preimage status; copied bytes are verified before read-only/immutable sealing. No other capture is overwritten. The manifest is a reference artifact, not permission to publish runtime code.

Owned plan formatting, frozen author formatting and final tracked diff checks are recorded in evidence/final-checks.json. The final manifest hash is returned in the handoff rather than embedded in its own hashed contents.
