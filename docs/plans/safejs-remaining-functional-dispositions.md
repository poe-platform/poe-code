# Remaining SafeJS functional dispositions

## Decision and ownership

**Ready for a separate independent disposition validator, not a claim that remediation is finished.** This sidecar reconciles all **47 original scope rows** (21 ranked groups / 23 ranked IDs, two unranked candidates, three historical documentation rows, 21 observations). These are not 47 confirmed bugs. G01, the new enumerable-host-getter observation, is recorded separately; known supplemental observations remain dependencies rather than being silently dropped.

- Sole authored artifact: `docs/plans/safejs-remaining-functional-dispositions.md` in `/Users/kjopek/Workspace/poe-code-safejs-remaining-dispositions`. No production, README, test, master-ledger, original-clone, shared-clone or publisher-clone edits. No staging, commits, pushes, extra branches, release approval, or publication performed.
- Kuhn exclusively owns the publisher master ledger. Its read-only capture is fingerprinted below. This document proposes dispositions; only the coordinator/publisher may reconcile them into that master. Independent disposition acceptance is **pending**. All proposed documentation/runtime work still needs its own author, different validator, immutable intake, and SERIAL pull/commit/push/actual-publication gates.
- Cloned the publisher's origin `git@github.com:poe-platform/poe-code.git` directly onto local `main`, then successfully ran `git -c pull.rebase=false pull --ff-only` before source investigation or dependency setup: **Already up to date**. Pinned HEAD throughout: **`ecfd838abd37fb061d66dc8721bc3f86067139ad`**. All “current” results below mean this captured main, not a later concurrently published head.
- The handoff and publisher report npm release **11.0.8** at this base; this worker verified local commits, not npm publication. Package `0.0.0-dev` is not a registry version. Seven ranked implementations are present/reported published; their original independent test receipts are publisher evidence, not tests rerun by this sidecar.
- Historical original-worktree qualification: a configured-rebase pull failed before fetch; a subsequent non-rebase fast-forward pull fetched origin/tags then aborted on unrelated dirty package files without merging. Do not claim no original Git-ref mutation. No original worktree file changes, stash, reset, staging, commit or push were made by that setup attempt. This sidecar only reads explicitly permitted original evidence.
- Read ancestor/root AGENTS and the SafeJS skill. User-authorized nonoverlapping parallel fix/validation lanes supersede the earlier one-at-a-time restriction. This direct worker does not delegate or implement another lane. Functional remediation checks are authorized; security research, unsolicited coverage expansion, LLM calls, guest filesystem/network/process capabilities, and stress work remain excluded.

## Audit bootstrap and evidence boundaries

Before original payload reads, loaded only `../poe-code/out/safejs-audit-2026-08-27/inventory-verification.json` as bootstrap and established its exact **38** `archiveReadPolicy.excludedPaths`, normalized against the original root. Also excluded the **entire security/** directory and the metadata-declared outside-cohort provenance directory. Every subsequent original read used a concrete allowlist and path guard. No recursive audit discovery, excluded-file reads/hashes/execution, or archive probes occurred.

Bootstrap SHA-256: `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827`. SHA-256 of `JSON.stringify(archiveReadPolicy.excludedPaths)` in stored order: `31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13`. This hashes allowed metadata strings, not excluded bytes. The historical inventory's own older bootstrap hashes and read-deviation notes are not this worker's receipts.

Path notation: **A/** = `../poe-code/out/safejs-audit-2026-08-27/` relative to this checkout root; **P/** = `../poe-code-safejs-publish/`. Original audit artifacts are historical and uncommitted; they are linked by path/hash, not copied wholesale into Git. `REPORT.md`, `inventory.json`, and `SNIPPETS.md` preserve original outcomes, source kinds, expected/actual pointers and controls. Current checks never rewrite those labels.

## Complete 47-row reconciliation

Class totals: **7 published**, **16 open ranked/candidate groups**, **6 documentation gaps**, **5 pending targeted validation/contract dispositions**, **3 qualified upstream resolutions**, **4 documented/nonbug controls**, **3 coverage-only rows**, **1 bounded-completion observation**, **1 historical repair**, **1 attribution qualification** = **47**. These are primary row dispositions, not a count of bugs or all sub-observations. In particular, “resolved-qualified” does not certify every original workflow.

| Row | IDs / scope                                                       | Primary disposition | Current evidence and remaining obligation                                                                                                                                                |
| --- | ----------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | COLL-001                                                          | published           | f685e08b; publisher reports 11.0.5. Direct live iteration is separate from O01/O02; supplemental test-typing repair still pending.                                                       |
| R02 | ARRAY-OWN-METADATA (STR-01, NUM-002)                              | open                | Own metadata reads still undefined on this base. C-ARRAY integration candidate is not merged; retain checkpoint/key-order companions.                                                    |
| R03 | OBJ-001                                                           | published           | ecfd838a; publisher reports 11.0.8. Alias preservation is present; not OBJ-002/OBJ-003 closure.                                                                                          |
| R04 | SOURCE-EXCEPTION-COERCION (AW-001, AW-002)                        | open                | Current source error-shaped record loses identity/code; no candidate manifest supplied in captured publisher ledger.                                                                     |
| R05 | MC-003                                                            | published           | a962264d; publisher reports 11.0.2. Numeric constants only; MC-002 namespace identity remains separate.                                                                                  |
| R06 | RETAINED-CALLBACK-DELIVERY (CBI-001)                              | open                | C-CBI standalone READY is publisher-reported, not merged. O05/O12/O13/O14 are not automatically the same defect.                                                                         |
| R07 | NUM-001                                                           | open                | Two-parameter function.length is undefined instead of 2. C-NUM is unmerged; source callable writes are O08.                                                                              |
| R08 | OBJ-002                                                           | open                | Sparse structuredClone still throws. C-OBJ2 latest typing-rereview supersedes earlier 15-diagnostic capture; merged validation pending.                                                  |
| R09 | AR-001                                                            | open                | Original plain-host checkpoint reduction still rejects reentry. C-AR is isolated READY only; D02 is distinct.                                                                            |
| R10 | PPR-002                                                           | open                | Raw completed input replay still throws missing-created-work TypeError. C-PPR preserves working-v6, not historical broken raw-v6 recovery.                                               |
| R11 | STR-03                                                            | published           | 33c73a21; publisher reports 11.0.4. Replacement only, not STR-01/STR-04/STR-05 or regex own-key order.                                                                                   |
| R12 | STR-04                                                            | open                | matchAll ignores initial lastIndex (2 matches instead of 1). C-STR4 requires ARRAY metadata integration; do not duplicate metadata fix.                                                  |
| R13 | LANG-01                                                           | open                | Read-only nested reduce still rejects reentry instead of 6. C-LANG is unmerged; preserve O01 mutation restriction separately.                                                            |
| R14 | CONTEXTUAL-FROM (TREE-01)                                         | published           | 9ed57df2; publisher reports 11.0.6. U02 keyword return and async computed methods still fail; no automatic deduplication.                                                                |
| R15 | OBJ-003                                                           | open                | Object.fromEntries(new Map(...)) still throws instead of producing the entry object; iterable-input contract remains actionable.                                                         |
| R16 | MC-001                                                            | published           | b7dfa471; publisher reports 11.0.3. Infinity/NaN lint allowlist only, not MC-003 runtime or MC-002 namespace parity.                                                                     |
| R17 | STR-02                                                            | open                | Global no-match returns [] rather than null twice. No captured separate candidate supplied.                                                                                              |
| R18 | STR-05                                                            | open                | C-STR5 isolated scoped READY, not merged. Original unmatched/zero-width capture obligations remain; no new implementation here.                                                          |
| R19 | HI-002                                                            | published           | 4358488f; publisher reports 11.0.7. Markdown offset repair differs from D01 historical lint policy.                                                                                      |
| R20 | CTX-001                                                           | open                | map thisArg still rejects rather than [8,12]. C-CTX isolated READY; native receiver/call suffix and merged array paths still need independent validation.                                |
| R21 | MC-002                                                            | open                | Keep namespace singleton compatibility mismatch open; weaker derived contract is not a waiver. Captured current-main lane receipt absent; no whole graph parity claim.                   |
| U01 | PPR-001                                                           | open                | Exact original alias control fails twice in both public bindings and entrypoint inputs. Distinct from completed replay PPR-002.                                                          |
| U02 | IP-002                                                            | open                | Keyword return shorthand still fails parsing; native returns 7. Preserve async-computed companion, not folded into published TREE-01.                                                    |
| D01 | HI-001                                                            | resolved-qualified  | Current nested await lint/run/native pass; repository docs/template and inspected installed agents skill agree. Not full original SDK rerun or all installed skills certification.       |
| D02 | AR-002                                                            | nonbug              | Current prewrapped control distinguishes dumpCurrent now from dump next-yield; current README documents next-yield. AR-001 plain-host failure remains.                                   |
| D03 | AR-003                                                            | doc-gap             | Source generator suspended across await snapshots/resumes [1,2]; blanket public generator prohibition remains too broad.                                                                 |
| O01 | MUTATION-GUARD; COLL-002; LANG-02                                 | doc-gap             | Current deliberate structural-mutation reentry refusals; broad public method coverage needs explicit scoped qualification, not incidental removal.                                       |
| O02 | EAGER-ENUMERATION                                                 | nonbug              | Current eager array snapshot matches express skill contract; native live iterator divergence is intentional only for explicit methods.                                                   |
| O03 | REGEX-SUBSET                                                      | doc-gap             | Named exclusions remain unsupported; u/y flag refusals still lack equally specific public documentation. No automatic regex feature expansion.                                           |
| O04 | LINT-RUNTIME; LINT-01                                             | resolved-qualified  | Current switch lint/run succeeds and broader syntax is documented. Historical conservative policy is not a current waiver.                                                               |
| O05 | ASYNC-PROOF-FIXTURES                                              | pending-validation  | Corrected fixture ordering is not a bug; source-function ordinary replay passes. Function-bearing external proof semantics remain a specific open validation ask.                        |
| O06 | PREWRAPPED-REPLAY-CORRECTION                                      | nonbug              | Ordinary wrapped native call is not repeated; legacy prewrapped closure repeats on replay with equal value. Historical correction confirmed.                                             |
| O07 | RUN-RESULT-SHAPE-DOC; SCHEMA-API-002                              | doc-gap             | Ordinary throws reject API promise; unsupported in result channel varies by source shape. Document both channels; no newly proved invariant violation.                                   |
| O08 | NUM-003; DECIMAL-CALLABLE-CUSTOMIZATION                           | doc-gap             | Current source callable own-property assignment is refused; retain explicit unsupported-feature documentation/contract task distinct from read-only arity.                               |
| O09 | BINARY-IN; TREE-02; SCHEMA-IN-001                                 | doc-gap             | Deliberately unsupported operator confirmed; public named exclusion not found. Source branch is not public documentation; own-only rewrite is not general in equivalence.                |
| O10 | CANCEL-OBS-01                                                     | pending-validation  | Live backend binding view changes cleanup 0→1, serialized checkpoint retains 0 and resumes 1. Public snapshot-view contract remains open; no replay corruption demonstrated.             |
| O11 | EDITOR-ORIGINAL-EXPECTATIONS                                      | resolved-qualified  | Historical constructor-lint assertion no longer holds; current new Error lint succeeds and ordinary throw rejects. C4 channel qualification remains O07; no full editor rerun claim.     |
| O12 | INPUT-ERROR-PROJECTION                                            | pending-validation  | Historical minimal Error proof projection is not a new defect. Exact complete-Error versus minimal-proof current replay still needs scoped comparison; AW result is not that proof.      |
| O13 | RAW-PROMISE-PENDING-WATCHDOGS                                     | pending-validation  | Current minimal raw pending capture is blocked by AR-001 before provider use. Four historic profiles/eight watchdogs remain unresolved, not proved refusal or consumed proof.            |
| O14 | ADAPTER-CHAIN-LIFECYCLE                                           | pending-validation  | Exact original single-input settled-at-capture control now resumes consumed with equal output. Four full adaptation/chain configurations still require current original-workflow replay. |
| O15 | RANDOM-TIME-NATIVE-PREFLIGHT                                      | coverage            | Two native-only originals remain coverage limits, not observed SafeJS failures or authorized new coverage campaign.                                                                      |
| O16 | INDEXED-DEADLINE-INCOMPLETE                                       | bounded-completion  | Exact original diagnostic fails two 3s attempts, completes unchanged under 15s once with native-identical full output/logs. No performance SLA or infinite-loop claim.                   |
| O17 | CAMERA-TYPED-NATIVE-ONLY                                          | coverage            | Three typed native-only configurations and unexecuted acosh retained; fround adaptations do not certify typed originals.                                                                 |
| O18 | COVERAGE-CAPTURE-LIMITS                                           | coverage            | Preserve synthetic CTX scope, missing fragments, invalid drivers and partial outputs. Neither new defects nor PASS; remediation repros are authorized.                                   |
| O19 | IV5-01; IV9-01; IV10-01; SOURCE-MAP-COMMAND/PLAN-LOCATION REPAIRS | historical-repair   | Historical metadata repairs retained; all 30 review-only outcomes/93 children mapped. Not current runtime validation or new production fixes.                                            |
| O20 | EXPECTED-ERROR-CONTROLS                                           | nonbug              | Selected cyclic JSON rejection confirmed; all original expected/unsupported controls preserved without claiming they all reran. O13 watchdogs are not these refusals.                    |
| O21 | HISTORICAL-POLICY/PROVENANCE-ATTRIBUTION                          | attribution         | Historical no-subagent attribution is not current user policy; retain lineage/cutoff qualifications, no audit edits or runtime fix.                                                      |

## Contract decisions and exact remaining asks

### D01, D02 and D03: documentation history is not current proof

- **D01 / HI-001:** original eight associations are the Markdown DAG, Markdown generator/base/runtime-error and block-await direct/SDK cases recorded in the master. Current public lint accepts `{ const value = await Promise.resolve(7); return value; }`; native and current both return 7 twice (nine reported visits). README:135 and tracked skill:80–89 agree. Syntax/guidance commits `7bfc6eb1` / `7e802755` precede this base. The inspected installed `.agents` skill also agrees; other installed skill copies and all original SDK workflows were not revalidated. Resolve the obsolete nested-await restriction only, not HI-002 offsets or generator capture documentation.
- **D02 / AR-002:** used exact `A/async-replay/reductions/10-external-dump.js` with its ordinary-host and prewrapped variants. Both finish `{first:20,final:13}` (15 visits). With prewrapped closures, `dumpCurrent` produces a snapshot while `dump` remains pending at 80ms and produces one after the held call is released. README:274 explicitly says next yield. An observation timeout is not deadlock. `dumpCurrent` is an internal module export, not the public package-index API. With ordinary host functions both capture requests reject `reentry`: retain R09, not a D02 “fix”. Future C-AR API additions are not present at this base.
- **D03 / AR-003 — actionable documentation repair:** a source synchronous generator yields 1, remains suspended while its caller awaits, then yields 2. A fresh checkpoint (8,460 serialized bytes) resumes to `[1,2]`, same as first run and native control. The isolated wait is prewrapped to avoid conflating AR-001. README:144/:330 and skill:111 still say suspended generators cannot be snapshotted; CHECKPOINT_REPLAY:65–75 instead describes reconstructed source functions and an opaque-native/live-generator codec limit. Ask a documentation owner to distinguish supported source replay from unsupported opaque host iterator/frame serialization, preserving the measured example and both limits. Do not promise arbitrary host-generator capture; no README edit is authorized in this task.

### O01–O04 and O08–O09: intentional limits still need honest public contracts

- **O01:** original Map-forEach worklist and reduce/self-mutation cases remain conservative `reentry` refusals; both minimal current controls repeat. Native mutation completes. This is not LANG-01's read-only composition defect and must not be “fixed” by incidentally deleting mutation guards. README:165's broad method coverage does not currently spell out this callback-mutation exception. **Ask:** explicitly document the affected callback/receiver structural-mutation limit with a nonmutating control; if compatibility is to be expanded, assign a separately validated semantic change rather than silently weakening the broad contract.
- **O02:** native `Map.values()` sees a later insertion; current returns an already materialized array containing only the old value. Tracked skill:105 expressly says keys/values/entries return eager arrays. This is a documented nonbug, not a reason to regress COLL-001 default for-of live iteration.
- **O03:** selected lookahead, Unicode-flag and sticky-flag controls reject before runtime; native accepts. README:331 expressly excludes lookaround, backreferences, named groups and Unicode property escapes. The broader `u` and `y` flag refusals are not equivalent to the property-escape exclusion. Preserve all original c01–c06 controls; **ask:** precise supported-flag documentation and explicit compatibility decision for u/y, not an automatic new engine campaign or silent unsupported waiver.
- **O04:** switch with return 7 has no lint diagnostics and returns 7 twice; current public syntax guidance includes switch, var, this and sandbox constructors. Historical conservative lint/runtime divergence is obsolete for these forms, not grounds to ignore new lint defects. MC-001 is separately published.
- **O08:** assigning `configured.option = 3` to a source function still throws `TypeError: Assignment expressions require a sandbox object property.`, while native reads 3. Preserve NUM-003 histogram and both d3 formatter originals/custom-string reduction as unsupported callable customization, not new arithmetic failures. **Ask:** name this source-callable write limit in the public subset documentation and distinguish it from source-function arity and captured callable property-data preservation. Absence of an express promise is not enough to erase the derived compatibility concern.
- **O09:** binary `in` is deliberately rejected by interpreter code and is accepted by lint. A named public exclusion was not found in inspected README/template: this corrects the master's overly strong “documented intentional” label. **Ask:** document the explicit subset exception and channel behavior, while keeping own-field rewrites limited to own-property data. `Object.hasOwn` is not a prototype-bearing semantic substitute. No production operator implementation is requested here.

### O05–O07, O11–O14: replay and error-channel qualifications

- **O05:** the original per-call proof ordering correction remains a fixture correction, not evidence of runtime corruption. Current ordinary host-return of a source callback plus completed replay preserves identity and value `[true,7]` twice, with one total native call. This supports CHECKPOINT_REPLAY:65–75 only for that measured path. **Remaining ask:** on the integrated AR/PPR/CBI base, revalidate `A/async-replay/results.json#/schedulerBoundaries/1` and `#/correctedBoundaries/{0,1,3}`: distinguish an external proof's function-bearing result from a new callback invocation; preserve request/callback identity, joined/detached disposition, value and call order. Ordinary-return success does not close external-proof ergonomics. C-CBI/C-AR/C-PPR are dependencies, not assumed common cause.
- **O06:** completed ordinary injected function returns 7 and replay adds no native call (total one); equivalent legacy prewrapped closure returns 7 but executes again (total two). The historical zero-repeat expectation was wrong for the bypassed wrapper. Current confirmation closes that expectation only, not all replay/callback behavior.
- **O07:** top-level/default-export/awaited ordinary throws reject the API Promise with the ordinary error. Unsupported `in` returns `ok:false` at top level/awaited shape but rejects from a closure. Current README:265–268 documents resolved shapes without explaining the full rejection channel. **Ask:** a public caller example that handles both resolved interpreter errors and rejected application/API errors, and scoped shape qualifications. SCHEMA-API-002's old new-bug closure does not close this documentary gap; do not invent a universal always-resolve or shape-invariance promise.
- **O11:** current constructor lint accepts `new Error` and its thrown value rejects normally, as native does. Original editor C1–C3 old constructor-policy expectations are not current failures; C4's envelope expectation belongs to O07. Full original editor composition was not rerun, so no blanket full-workflow closure.
- **O12:** historical `input-promise-recovery:reject-right-first` used a reduced name/message proof instead of the complete captured Error representation; full-Error controls were separate. Public proof identity/outcome requirements remain in CHECKPOINT_REPLAY:110–145. **Remaining ask:** replay the same current fresh capture with its full modeled Error (including captured stack/identity graph), versus that deliberately minimal projection, retaining exact request identifiers and source trace. Classify any remaining identity mismatch after a valid proof separately from AW-001/002 source-error coercion. Current AW reduction fails, but that does not reproduce or close this input-proof case. No current complete-Error rerun is claimed.
- **O13:** current minimal raw pending input cannot obtain the required external snapshot: `dump(pending)` fails `reentry` before a provider is called. Original computation settles 7 after explicit release. Thus the two provider/no-provider branches did **not** execute restored replay, and empty request logs do not prove proper refusal, proof consumption, or deadlock. **Remaining ask:** after C-AR/C-PPR integration, rerun the four original pending profiles listed in the unresolved table, with exact held/immediate receipts, bounded cleanup and explicit consumption/call-suffix assertions. Preserve all eight old watchdogs as incomplete. Do not infer they share PPR-002's confirmed completed-input cause.
- **O14:** exact original `A/public-promise-adaptation/03-single-public-input-recovery.ajs` now passes a stronger fresh control: snapshot captured with input lifecycle **settled**, first run and replay both return `{value:7,sameHandle:true}`, final lifecycle **consumed** in both. Four automatic snapshots were observed; no replacement input supplied on replay. A separate already-consumed capture passes too, but is not the evidence for this result. **Remaining ask:** revalidate the four full adaptation/chain cases in the FAIL mapping on a fresh current capture, preserving all workflow aliases/mutations/closures/source traces/call suffixes and lifecycle states. Do not generalize the single-input success to chains or replace their observation-level FAIL labels with a PPR-002 fix claim. Historic jobs-v1 captures were not presented as natively valid current jobs-v6 captures.

### O10 and O15–O21: do not turn limits into bugs or passes

- **O10 — still open functional representation/contract qualification:** one controlled cancellation with a finally cleanup shows backend's live `snapshot.bindings.state` change from `{cleanup:0}` to `{cleanup:1}`. The value serialized at capture remains 0; fresh serialized replay returns 1, equal to final run. This is not a demonstrated replay-history/input-graph corruption. However, a public `SnapshotBackend.write(snapshot)` recipient can retain a mutable view, so “snapshot” carries a derived point-in-time expectation worth resolving. **Ask:** independently compare live view versus serialized heap/replay/inputs across the six original cancellation profiles, then either detach diagnostic binding views or explicitly document their live-only nature without weakening persisted checkpoint correctness. No assertion that all original 24 resumes reran here.
- **O15/O17:** preserve two native-only random retry preflights, three typed-camera native configurations, and zero executed acosh calls as coverage gaps. No SafeJS failure was observed for those particular configurations; no new coverage campaign or implementation is justified by missing execution alone.
- **O16:** ran exact original 11-operation radix progress diagnostic. Two current 3-second attempts end in deadline budget errors around operation 6; neither is PASS. One explicitly bounded 15-second attempt completes unchanged: 12 semantic snapshots, 12 structure snapshots, 125 trace events, all 167 diagnostic log entries, native/current normalized output SHA-256 `1e1738cb9d715a74031f787212557d922e69396777339b90f3ca1e95c68c5856`. Native/current logs also match. Process duration 9,059ms includes startup/native/control work, not a benchmark; returned stats.nodeVisits=4 is recorded literally and is not treated as whole-function execution coverage. This resolves the selected missing-completion witness, **not** a latency SLA, broad performance certification or historical timeout erasure. No production performance fix is justified by these receipts alone.
- **O18:** keep three missing historical Markdown stdout fragments unavailable, CTX's synthetic-only source scope, invalid drivers, native-oracle errors and partial watchdog outputs explicit. Passing rewritten variants do not certify originals. Current user authorization permits functional remediation checks despite closure of the old audit campaign; security/unsolicited expansion remains excluded.
- **O19:** IV5 review-only omission, IV9 histogram field basis, IV10 old 19/current 21 wording, source-map returnValue correction, and Markdown QA-plan relocation are historical reporting repairs confirmed by current allowed metadata. No production repair required; error/startup/timeout branches in that old source-map helper were not exercised. They remain historical receipts, not newly executed children or current release gates.
- **O20:** retain the 27 expected-rejection / 44 unsupported corpus labels and 412 historical PASS controls. Selected current cyclic JSON throws TypeError in native and current (wording differs). Deliberate application errors and documented missing callback-disposition refusals are not hidden bugs; not all old refusal profiles were rerun. O13's unresolved watchdogs must not be recategorized as successful refusal controls. Regex/binary-in qualifications remain O03/O09.
- **O21:** preserve original source lineage/cutoff limits and the unestablished iterable-pipelines no-additional-agent attribution. It is not a user prohibition. The coordinator delegates fix and independent validation to different workers; this sidecar does not rewrite historical policy or provenance.

## G01: enumerable host getter, functional triage only

**Current low-level difference reproduced; keep an explicit open embedding/bookkeeping fix ask.** This is not an ARRAY metadata regression verdict, not a demonstrated public-run getter-support bug, and not security research. The earlier evidence points to unchanged graph measurement; prior base reproduction alone would not waive it.

- Input: ordinary host object with own getter `method`; source computes receiver/key/argument and calls the returned method, while the argument changes a local receiver variable. The getter increments a read counter; its callable returns receiver-plus-argument only while that counter is 1, otherwise -1. Expected native result is **10**, ordered trace **receiver, key, get, argument, call**, final local value **100**.
- Current low-level `interpret(parseModule(...))`, supplied already-internal bindings, returns **-1** with **32 getter reads**, including reads before source receiver evaluation. Repeated twice. Optional null-return getter control preserves undefined/no argument evaluation but still adds getter reads. Same low-level cases with a nonenumerable getter match the native value/order twice.
- Current **public** `run` with the raw enumerable accessor input rejects **TypeError: Unsupported sandbox value at <root>.method: accessor property** before invoking the getter (**zero reads**). Public `deepCopyToSandbox` and a host-result boundary also reject before any getter invocation. Nonenumerable fields are omitted by public copying; their apparent low-level success is not public getter support.
- Root distinction: `interp/values.ts:436` graph measurement uses `Object.entries(value)`, which invokes supplied getters; descriptor-aware public copying at `interp/values.ts:881` rejects enumerable accessors. `interpret` is not exported by package index or ./core; the internal input path bypasses normal public normalization. General public plain-object support does not establish arbitrary accessor support, but neither fact silently closes the low-level side-effect observation.
- **Tight ask:** internal embedding/value owner should prevent measurement from invoking supplied accessors, or enforce descriptor rejection at that low-level input boundary with a deterministic functional diagnostic. Independently retain native call order, optional short-circuit, ordinary property/function behavior, and the existing public zero-getter-read refusal. Decide the internal SandboxValue descriptor invariant explicitly. Do not implement guest getter syntax or broaden into probes/security controls. Public-boundary documentation should accurately describe the measured accessor restriction.
- Original sidecar input: `../poe-code-safejs-array-metadata/out/safejs-remediation/array-own-metadata-validation/revalidation-call-order/candidate-051cfa0474bd5d62/evidence/REVALIDATION.md`; three exact companion evidence JSON paths are fingerprinted below. No candidate production file was copied or modified.

### Other already-reported companions retained

| Companion                                    | Disposition at this base                                                           | Exact dependency / remaining ask                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Array custom metadata/raw through checkpoint | Existing R08 contract/capture dependency, not closed by R02 live-property fix      | Publisher reports keys [0,metadata,raw] → [0] and lost shared aliases at snapshot/serialize.ts:444. Latest C-OBJ2 covers scoped metadata/raw but is unmerged; require fresh merged checkpoint proof. Earlier evidence: ../poe-code-safejs-array-metadata/out/safejs-remediation/array-own-metadata-validation/checkpoint-metadata-control.json (pointer only, not read here). |
| Regex match own-key order                    | Explicit open functional compatibility observation, not STR-03 replacement closure | Prior candidate evidence expects [0,1,index,input,groups], observes [0,1,groups,index,input]. Revalidate after C-ARRAY on current merged base; assign metadata-construction ordering owner if it persists. No current local full-result certification.                                                                                                                        |
| Async computed object method shorthand       | Current parser mismatch confirmed twice                                            | Native returns 7; current ParseError at 1:24. IP-002 parser-companion ask; avoid duplicate TREE-01 work or unsupported waiver.                                                                                                                                                                                                                                                |
| COLL001 supplemental test typing             | Publisher-tracked follow-up, not a new runtime defect                              | Three TS2345 diagnostics; author repair handoff ../poe-code-safejs-collection-test-types/out/safejs-remediation/coll-001-test-types/handoff.json indexes manifest 1017fd3755dbeef609739c6cd131763a035f8f586a7134b1a47ad89698139ace. Independent validation pending in captured ledger. No production edits here.                                                              |

## Parallel dependencies, not implementation authorization

The following are **reported by the fingerprinted publisher ledger**, not independently read/hashed or validated candidate manifests by this worker. They are absent from this pinned main. Later entries supersede earlier failed/author-only captures; neither old rejection nor later standalone READY is silently discarded. The parent must check latest intake ownership and preimages before use. No candidate is publication-approved by this sidecar.

| Capture | Scope                                         | Exact read-only pointer                                                                                                                                | Reported candidate manifest SHA-256                                | Remaining gate                                                                                                                                                     |
| ------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-ARRAY | R02 / checkpoint and key-order companions     | `../poe-code-safejs-array-metadata-integrated/out/safejs-remediation/array-own-integration/manifest.json`                                              | `67033146c54377d0a0188c55ab4579946a0152d2e52f957a22cbf1d8701df542` | Merged author candidate, independent original-workflow validation pending; older isolated 051cfa capture supplies getter evidence only.                            |
| C-NUM   | R07                                           | `../poe-code-safejs-function-arity/out/safejs-remediation/num-001-validation/candidate/manifest.json`                                                  | `ab188c65b988fbc10a93802350ef6c2a33c980d9d7855ed9f8571c9560c7e6b1` | Isolated independent READY; merged interpreter validation required.                                                                                                |
| C-CBI   | R06; O05/O12/O13/O14 conditional dependencies | `../poe-code-safejs-callback-delivery/out/safejs-remediation/cbi-001-validation/post-build/candidate/manifest.json`                                    | `bb00ab9add6a9f5d8340942d4e70e43e3a57bb2b218059a1035bbc196c8a3768` | Supersedes environment-failed capture; standalone READY only.                                                                                                      |
| C-OBJ2  | R08; array metadata/raw checkpoint companion  | `../poe-code-safejs-sparse-checkpoint/out/safejs-remediation/obj-002-validation/typing-rereview/candidate-20260829-obj002-noether-types/manifest.json` | `d075457f0b3e77f3360b372a54132221c02b93153a221ffe86d7dae639af276e` | Latest typing rereview READY, 15→0 owned diagnostics; supersedes earlier red capture. Configured full gate was cache replay, not fresh. Merged validation pending. |
| C-AR    | R09; D02/O05/O13                              | `../poe-code-safejs-external-checkpoint/out/safejs-remediation/ar-001-validation/candidate-manifest.json`                                              | `31a463196a63eb3974e2f327bf71f3a1ae682150ed4834e716edc1a01afd9f7b` | Isolated READY; future API/capture behavior not applied here.                                                                                                      |
| C-PPR   | R10; O05/O12/O13/O14 conditional dependencies | `../poe-code-safejs-public-promise-recovery/out/safejs-ppr-002-independent-rereview/candidate/manifest.json`                                           | `64b0d70928472558f48bfedeae6699cabd3107c44ef682c2a7a66b01da56cb32` | Scoped PASS supersedes blanket-compatibility rejection; preserves working-v6, fresh-v7 works, broken raw-v6 still rejects.                                         |
| C-STR4  | R12; R02 dependency                           | `../poe-code-safejs-regex-cursor/out/safejs-remediation/str-04-validation/manifest.json`                                                               | `fd5a5e8271afcb96478af1204c20c794371c2b3f550cea8327f7477f0bf5b117` | Not READY: 118 full-result failures attributed to unmerged ARRAY match.index metadata; needs merged revalidation.                                                  |
| C-LANG  | R13; preserve O01 restrictions                | `../poe-code-safejs-nested-array-reads/out/safejs-remediation/lang-01-validation/readiness.json`                                                       | `974b81a0571149eeef492b558a27654ffd7e5a8c8ba163012b933e40789fecc3` | Readiness file indexes the candidate manifest with this hash; isolated scoped READY, fresh merged array.ts validation pending.                                     |
| C-CTX   | R20                                           | `../poe-code-safejs-callback-this/out/safejs-remediation/ctx-001-validation/candidate/hash-manifest.json`                                              | `ded61063458521da5da7c84e1071770eceaaf29b61b485ecfe10e49ea1639f7f` | Isolated READY; preserve other published and unmerged array changes.                                                                                               |
| C-STR5  | R18                                           | `../poe-code-safejs-split-captures/out/safejs-remediation/str-05-validation/manifest.json`                                                             | `a87ddee6928bc8074bec855c5e26402cff6120a289bafcc328edb3ab557791a6` | Isolated scoped READY; later string merge needs independent validation.                                                                                            |

No exact unmerged candidate capture is supplied by the captured ledger for AW-001/002, OBJ-003, STR-02, MC-002, PPR-001 or IP-002; do not invent one or assume the coordinator has no active worker. Route the asks to the parent for lane/capture association, not to a duplicate implementation.

**Recommended nonoverlap:** documentary reconciliation can be authored as its own plan/spec change in a separate checkout, without editing README until allowed. Source-function/callback proofs, public Promise lifecycle and checkpoint representation share host-call/interpreter/values/snapshot ownership and require coordination rather than parallel writes to the same files. G01 touches values/measurement and therefore conflicts with ARRAY/OBJ/AW core integration; triage can remain read-only now. IP parser companions can be independently validated once their exact parser owner is frozen. Every core merge needs distinct independent merged validation; pull/commit/push/actual release stay SERIAL.

## Historical outcome accounting: no row dropped

The original active-functional corpus has **628 cases**: **412 PASS + 128 FAIL + 27 expected-rejection + 44 unsupported + 17 unresolved**. These are fixed historical labels, not a current pass-rate report. All 128 FAIL cases map below; original expected/actual/source/run details remain in A/inventory.json at the given pointer and A/SNIPPETS.md. Aliases: DP-1/LA-01/PDR-01→R14; DP-2→R02; CPC-01→R08; IP-001/LA-L1→R13; PDR-02→R19. Different labels do not create duplicate issues.

### All 128 historical FAIL cases

| Original case ID                                                   | Disposition row(s) | Original inventory pointer |
| ------------------------------------------------------------------ | ------------------ | -------------------------- |
| `collections:07-map-worklist-reachability`                         | R01                | `#/cases/8`                |
| `collections:08-set-worklist-reachability`                         | R01                | `#/cases/9`                |
| `collections:10-map-growth-reduction`                              | R01                | `#/cases/11`               |
| `collections:11-set-growth-reduction`                              | R01                | `#/cases/12`               |
| `collections:12-map-update-delete-reduction`                       | R01                | `#/cases/13`               |
| `collections:13-set-delete-reduction`                              | R01                | `#/cases/14`               |
| `objects:clone-structured`                                         | R08                | `#/cases/18`               |
| `objects:pick-transform`                                           | R03                | `#/cases/30`               |
| `objects:pick-transform-mutate`                                    | R03                | `#/cases/31`               |
| `objects:pick-map-entries`                                         | R15                | `#/cases/32`               |
| `objects:pick-generator-entries`                                   | R15                | `#/cases/33`               |
| `objects:identity-entries`                                         | R03                | `#/cases/34`               |
| `objects:identity-values`                                          | R03                | `#/cases/35`               |
| `objects:identity-from-entries`                                    | R03                | `#/cases/36`               |
| `objects:structured-empty-sparse`                                  | R08                | `#/cases/37`               |
| `objects:structured-sparse-value`                                  | R08                | `#/cases/38`               |
| `objects:from-entries-map`                                         | R15                | `#/cases/40`               |
| `objects:from-entries-generator`                                   | R15                | `#/cases/41`               |
| `strings:04-semver-coerce-sort`                                    | R02                | `#/cases/52`               |
| `strings:06-template-replacement-unicode`                          | R02, R11           | `#/cases/54`               |
| `strings:07-mustache-scanner-offset`                               | R02                | `#/cases/55`               |
| `strings:r01-match-metadata`                                       | R02                | `#/cases/65`               |
| `strings:r02-semver-overlap-progress`                              | R02                | `#/cases/66`               |
| `strings:r03-replacement-captures`                                 | R11                | `#/cases/67`               |
| `strings:r04-replacement-context`                                  | R11                | `#/cases/68`               |
| `strings:r05-global-lastindex`                                     | R12                | `#/cases/69`               |
| `strings:r06-no-global-match`                                      | R17                | `#/cases/70`               |
| `strings:r07-zero-width-split`                                     | R18                | `#/cases/71`               |
| `language:10-reduce-nested-readonly`                               | R13                | `#/cases/83`               |
| `language:12-typescript-cartesian-readonly-ranking`                | R13                | `#/cases/85`               |
| `language:13-sort-catch-reduce-reentry`                            | R13                | `#/cases/86`               |
| `async-replay:05-callback-checkpoint::callback-reissue`            | R09                | `#/cases/120`              |
| `async-replay:05-callback-checkpoint::callback-external`           | R09                | `#/cases/121`              |
| `async-replay:06-pending-retry-map::retry-reissue`                 | R09                | `#/cases/122`              |
| `async-replay:06-pending-retry-map::retry-external`                | R09                | `#/cases/123`              |
| `async-replay:06-pending-retry-map::retry-external-missing`        | R09                | `#/cases/124`              |
| `async-replay:07-co-live-checkpoint::co-live`                      | R09                | `#/cases/125`              |
| `async-replay:10-external-dump::plain`                             | R09                | `#/cases/129`              |
| `async-workflows:01-waterfall-identity`                            | R04                | `#/cases/137`              |
| `async-workflows:04-nested-finally-precedence`                     | R04                | `#/cases/140`              |
| `async-workflows:05-saga-delegation-cleanup`                       | R04                | `#/cases/141`              |
| `async-workflows:06-scan-reduce-state`                             | R04                | `#/cases/142`              |
| `async-workflows:07-forkjoin-last-values`                          | R04                | `#/cases/143`              |
| `async-workflows:08-plain-thenable-combinators`                    | R04                | `#/cases/144`              |
| `async-workflows:09-rejection-identity-matrix`                     | R04                | `#/cases/145`              |
| `async-workflows:10-recovery-annotation`                           | R04                | `#/cases/146`              |
| `async-workflows:12-finally-domain-records`                        | R04                | `#/cases/148`              |
| `async-workflows:13-domain-error-metadata`                         | R04                | `#/cases/149`              |
| `data-pipelines:patch-sequence`                                    | R14                | `#/cases/150`              |
| `data-pipelines:patch-backward-move`                               | R14                | `#/cases/151`              |
| `data-pipelines:patch-root-replace`                                | R14                | `#/cases/152`              |
| `data-pipelines:patch-failed-test`                                 | R14                | `#/cases/153`              |
| `data-pipelines:lcs-records`                                       | R02                | `#/cases/157`              |
| `data-pipelines:lcs-duplicates`                                    | R02                | `#/cases/158`              |
| `numerics:08-bisector-stable-ordering`                             | R07                | `#/cases/179`              |
| `numerics:09-histogram-object-configuration`                       | R02                | `#/cases/180`              |
| `numerics:11-function-arity-reduction`                             | R07                | `#/cases/182`              |
| `numerics:13-array-metadata-reduction`                             | R02                | `#/cases/184`              |
| `harness-integration:02-markdown-dag::direct::base`                | D01, R19           | `#/cases/196`              |
| `harness-integration:04-markdown-generator::direct::base`          | D01, R19           | `#/cases/205`              |
| `harness-integration:04-markdown-generator::direct::runtime-md`    | D01, R19           | `#/cases/206`              |
| `harness-integration:04-markdown-generator::sdk::wrapped-error`    | R19                | `#/cases/210`              |
| `harness-integration:07-block-await::direct::base`                 | D01, R19           | `#/cases/225`              |
| `harness-integration:08-offset::direct::base`                      | R19                | `#/cases/227`              |
| `harness-integration:08-offset::sdk::base`                         | R19                | `#/cases/229`              |
| `tree-reconciliation:02-append`                                    | R14                | `#/cases/238`              |
| `tree-reconciliation:02-prepend`                                   | R14                | `#/cases/239`              |
| `tree-reconciliation:02-remove`                                    | R14                | `#/cases/240`              |
| `tree-reconciliation:02-rotate`                                    | R14                | `#/cases/241`              |
| `tree-reconciliation:02-mixed`                                     | R14                | `#/cases/242`              |
| `tree-reconciliation:02-replace-all`                               | R14                | `#/cases/243`              |
| `tree-reconciliation:02-unkeyed`                                   | R14                | `#/cases/244`              |
| `tree-reconciliation:02-reverse`                                   | R14                | `#/cases/245`              |
| `tree-reconciliation:reduced-from-property`                        | R14                | `#/cases/278`              |
| `linear-algebra:04-quaternion-slerp-rotate.safejs`                 | R14                | `#/cases/294`              |
| `linear-algebra:contextual-from-binding.safejs`                    | R14                | `#/cases/299`              |
| `checkpoint-composition:codec-ascii`                               | R08                | `#/cases/305`              |
| `checkpoint-composition:codec-unicode`                             | R08                | `#/cases/306`              |
| `checkpoint-composition:reduced-sparse`                            | R08                | `#/cases/311`              |
| `iterable-pipelines:examples/01-buffer-window-zip`                 | R13                | `#/cases/318`              |
| `iterable-pipelines:examples/03-tee-shared-cache`                  | U02                | `#/cases/320`              |
| `iterable-pipelines:examples/04-cartesian-traversal`               | R13                | `#/cases/321`              |
| `iterable-pipelines:reductions/06-readonly-predicates`             | R13                | `#/cases/326`              |
| `iterable-pipelines:reductions/07-return-method`                   | U02                | `#/cases/327`              |
| `callback-inputs:map-prefulfilled`                                 | R06                | `#/cases/416`              |
| `callback-inputs:map-released`                                     | R06                | `#/cases/417`              |
| `callback-inputs:scan-prefulfilled`                                | R06                | `#/cases/418`              |
| `callback-inputs:scan-released`                                    | R06                | `#/cases/419`              |
| `callback-inputs:validation-prefulfilled`                          | R06                | `#/cases/420`              |
| `callback-inputs:validation-released`                              | R06                | `#/cases/421`              |
| `callback-inputs:counter-distinct`                                 | R06                | `#/cases/422`              |
| `callback-inputs:counter-identical`                                | R06                | `#/cases/423`              |
| `module-composition:graph--object-object`                          | R21, R05           | `#/cases/502`              |
| `module-composition:graph--map-map`                                | R21, R05           | `#/cases/503`              |
| `module-composition:graph--object-map`                             | R21, R05           | `#/cases/504`              |
| `module-composition:graph--map-object`                             | R21, R05           | `#/cases/505`              |
| `module-composition:graph-compatible--object-object`               | R21                | `#/cases/514`              |
| `module-composition:namespace-identity--object-object`             | R21                | `#/cases/515`              |
| `editor-runner-composition:C1`                                     | O11, O07           | `#/cases/554`              |
| `editor-runner-composition:C2`                                     | O11, O07           | `#/cases/555`              |
| `editor-runner-composition:C3`                                     | O11, O07           | `#/cases/556`              |
| `editor-runner-composition:C4`                                     | O11, O07           | `#/cases/557`              |
| `input-promise-recovery:reject-right-first`                        | O12                | `#/cases/576`              |
| `version-ranges:records:catalog-stable-carets`                     | R13                | `#/cases/579`              |
| `version-ranges:records:catalog-zero-carets`                       | R13                | `#/cases/580`              |
| `version-ranges:records:catalog-hyphen-x`                          | R13                | `#/cases/581`              |
| `version-ranges:records:catalog-or-any-null`                       | R13                | `#/cases/582`              |
| `version-ranges:records:catalog-prerelease-base-tuple`             | R13                | `#/cases/583`              |
| `version-ranges:records:catalog-include-prerelease`                | R13                | `#/cases/584`              |
| `version-ranges:records:selection-build-ties`                      | R13                | `#/cases/585`              |
| `version-ranges:records:selection-disjunction-negotiation`         | R13                | `#/cases/586`              |
| `version-ranges:records:selection-empty-intersection`              | R13                | `#/cases/587`              |
| `version-ranges:records:selection-catalog-hole`                    | R13                | `#/cases/588`              |
| `version-ranges:original-progress:catalog-stable-carets`           | R13                | `#/cases/599`              |
| `public-promise-recovery:full-pending-uninterrupted`               | U01                | `#/cases/634`              |
| `public-promise-recovery:full-prefulfilled-uninterrupted`          | U01                | `#/cases/635`              |
| `public-promise-recovery:alias-entryPointArgs`                     | U01                | `#/cases/636`              |
| `public-promise-recovery:alias-bindings`                           | U01                | `#/cases/637`              |
| `public-promise-recovery:full-completed-after-left`                | R10                | `#/cases/642`              |
| `public-promise-recovery:full-completed-both-pending`              | R10                | `#/cases/643`              |
| `public-promise-recovery:single-completed-restore`                 | R10                | `#/cases/645`              |
| `public-promise-adaptation:full-prefulfilled-after-left-restore`   | O14                | `#/cases/650`              |
| `public-promise-adaptation:full-prefulfilled-both-pending-restore` | O14                | `#/cases/651`              |
| `public-promise-adaptation:single-completed-restore`               | O14                | `#/cases/653`              |
| `public-promise-chain:prefulfilled-resume-a`                       | O14                | `#/cases/657`              |
| `public-promise-chain:prefulfilled-resume-b`                       | O14                | `#/cases/659`              |
| `callback-context-controls:map-thisarg`                            | R20                | `#/cases/660`              |
| `callback-context-controls:foreach-thisarg`                        | R20                | `#/cases/661`              |

### All 17 historical unresolved cases

| Original case ID                                                  | Disposition row | Original inventory pointer |
| ----------------------------------------------------------------- | --------------- | -------------------------- |
| `async-replay:10-external-dump::sandbox-closure`                  | D02             | `#/cases/130`              |
| `random-time-replay:03-retry-planner-seed-123-preflight-original` | O15             | `#/cases/388`              |
| `random-time-replay:03-retry-planner-seed-42-preflight-original`  | O15             | `#/cases/390`              |
| `cancellation-replay:map::two-workers`                            | O10             | `#/cases/393`              |
| `cancellation-replay:map::verify`                                 | O10             | `#/cases/394`              |
| `cancellation-replay:graph::computed`                             | O10             | `#/cases/396`              |
| `cancellation-replay:graph::review`                               | O10             | `#/cases/397`              |
| `cancellation-replay:scan::replacement`                           | O10             | `#/cases/399`              |
| `cancellation-replay:scan::unseeded-fold`                         | O10             | `#/cases/400`              |
| `indexed-structures:radix-branch-split-progress`                  | O16             | `#/cases/536`              |
| `inverse-coordinate-transforms:camera-axis-frustum-typed`         | O17             | `#/cases/568`              |
| `inverse-coordinate-transforms:camera-oblique-frame-typed`        | O17             | `#/cases/570`              |
| `inverse-coordinate-transforms:camera-offset-handoff-typed`       | O17             | `#/cases/572`              |
| `public-promise-recovery:pending-after-left-held-proofs`          | O13             | `#/cases/638`              |
| `public-promise-recovery:pending-after-left-immediate-proofs`     | O13             | `#/cases/639`              |
| `public-promise-recovery:pending-both-pending-immediate-proofs`   | O13             | `#/cases/640`              |
| `public-promise-recovery:pending-missing-provider`                | O13             | `#/cases/641`              |

### All 30 review-only configurations / 93 historical children

These are not additional corpus cases or new sidecar executions. Retained publisher mapping follows; “retained passing control” means historical evidence only. Ranked destinations use the 47-row current qualification above. O09's public-documentation gap overrides any older shorthand calling it already documented.

| Review-only configurations                             | Count | Baseline labels    | Master disposition                                                       |
| ------------------------------------------------------ | ----: | ------------------ | ------------------------------------------------------------------------ |
| `parser-diagnostics-review:T03`                        |     1 | FAIL               | CONTEXTUAL-FROM / TREE-01                                                |
| `parser-diagnostics-review:D03`                        |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `parser-diagnostics-review:D04`                        |     1 | FAIL               | HI-002                                                                   |
| `parser-diagnostics-review:D05`                        |     1 | FAIL               | HI-002                                                                   |
| `callback-loss-review:counter-no-input`                |     1 | MIXED              | RETAINED-CALLBACK-DELIVERY / CBI-001; keep first-boundary failed resumes |
| `data-pipelines-review:compatible-lcs-records`         |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `data-pipelines-review:compatible-lcs-duplicates`      |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `data-pipelines-review:compatible-lcs-empty-left`      |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `data-pipelines-review:compatible-patch-sequence`      |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `data-pipelines-review:compatible-patch-backward-move` |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `data-pipelines-review:compatible-patch-root-replace`  |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `data-pipelines-review:compatible-patch-failed-test`   |     1 | expected-rejection | O20 expected application error control                                   |
| `data-pipelines-review:diagnostic-patch-binding-only`  |     1 | FAIL               | CONTEXTUAL-FROM / TREE-01                                                |
| `data-pipelines-review:array-own-read`                 |     1 | FAIL               | ARRAY-OWN-METADATA / DP-2                                                |
| `data-pipelines-review:array-extracted-call`           |     1 | FAIL               | ARRAY-OWN-METADATA / DP-2                                                |
| `data-pipelines-review:array-alternate-name`           |     1 | FAIL               | ARRAY-OWN-METADATA / DP-2                                                |
| `data-pipelines-review:object-record`                  |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `module-composition-review:graph-compatible::harness`  |     1 | FAIL               | MC-001; actual harness lint gate failure, not intentional exclusion      |
| `error-channel-review:ordinary-top`                    |     1 | expected-rejection | O07/O20 expected application rejection                                   |
| `error-channel-review:ordinary-default`                |     1 | expected-rejection | O07/O20 expected application rejection                                   |
| `error-channel-review:ordinary-await`                  |     1 | expected-rejection | O07/O20 expected application rejection                                   |
| `error-channel-review:unsupported-top`                 |     1 | unsupported        | O07 channel qualification and O09 binary-in unsupported                  |
| `error-channel-review:unsupported-default`             |     1 | unsupported        | O07 channel qualification and O09 binary-in unsupported                  |
| `error-channel-review:unsupported-await`               |     1 | unsupported        | O07 channel qualification and O09 binary-in unsupported                  |
| `set-iteration-review:eager-values-control`            |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `from-entries-alias-review:FE02`                       |     1 | FAIL               | OBJ-001; direct source pair arrays isolate fromEntries alias loss        |
| `from-entries-alias-review:FE03`                       |     1 | FAIL               | OBJ-001; direct source pair arrays isolate fromEntries alias loss        |
| `from-entries-alias-review:FE04`                       |     1 | FAIL               | OBJ-001; direct source pair arrays isolate fromEntries alias loss        |
| `keyword-method-review:method-close`                   |     1 | PASS               | Retained passing control; no new actionable defect                       |
| `keyword-method-review:method-async-name`              |     1 | PASS               | Retained passing control; no new actionable defect                       |

## Current execution receipts

Host setup in this isolated clone only:

`npm ci --ignore-scripts --no-audit --no-fund` — exit 0, 548 packages installed; no install lifecycle scripts.

`node_modules/.bin/turbo run build --filter='@poe-code/safejs^...' --output-logs=errors-only --log-prefix=none` — exit 0, 67 dependency tasks successful, 26.823 seconds. The graph selected all 67 workspace dependency packages; this is build setup, not 67 tests. Four untracked font assets generated by that build were removed after validation; no tracked build output is part of this document. No production changes, full test suite, security/adversarial suites, external guest capabilities, or screenshot/LLM campaign were run. No CLI visual behavior changed.

Runtime commands were finite inline Node/tsx checks, cwd this checkout, with the documented case budgets, native vm timeout and outer process limit. All receipt commands are `node --import tsx --input-type=module`, program provided on stdin. SHA-256 columns fingerprint the **actual** input/output bytes, including timestamps. Exit 0 means the observational helper returned its report, **not** that every semantic comparison passed.

| Receipt                                   | Exit | Host duration ms | Actual stdin SHA-256                                               | Actual stdout SHA-256                                              |
| ----------------------------------------- | ---: | ---------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| current-public-controls                   |    0 |              816 | `81008e81b6569c9ceda07c7ae559cb087183be3c4a60a826ed87761d62e351de` | `90e93cc0704adad1687d7c41e45ad911ba40f9d295f348309f09e7e191fdaefb` |
| getter-functional-boundaries              |    0 |              542 | `dd932fa0481ccc57af2db17d5a925a008ee73cf61583fa06b7c4ef8d856804a0` | `f483afe72f3327dd0d677730aa36d8129086f5687594b45d4a2b59a75e9c81c5` |
| native-adapter-correction                 |    0 |              451 | `9b5cb83a18bf04a28efdcc274916ba1e5c2e6d323e31f8720c3fe6dbea612935` | `9e4d764c1933f1406cce5db8521309dc474041867811b109b07ab9f897f26dcd` |
| checkpoint-and-replay-boundaries          |    1 |             1118 | `02efc2badcb33395d7ccd270e2cd11ab9ab300dca1607a7d59beb43bef66d41b` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| checkpoint-and-replay-boundaries-captured |    0 |              765 | `9570db19ccab8c7da92e6119501d3c24bf21438a53fec7ebae6ae1cfeb014fd2` | `c764158ee6444ab70d07dbb9ed6e304f609f37e9143214b87c70397d3cddcdee` |
| original-public-promise-alias             |    0 |              609 | `0cb1e44467fc670242028da7bb25c45d1bb8c23597f9a04b1a10538b93236651` | `38fad758126da8c75153ffb539239dd4b21a33aba108caf637e0e536ab05f652` |
| cancellation-pending-lifecycle            |    0 |              492 | `8b1a205167ec4934f8552bf0b22405c441f763ae0726d932cb22c0486daf2907` | `3d2fb72697964afce53ee92b0e2bd06cf5b83d716b371988271362e84fe4f40e` |
| cancellation-pending-lifecycle-corrected  |    0 |              650 | `b91ef6ef13b8b166b6fffd1d8a70c366f8a5e44d71d6328be235f3918b47eb96` | `e67cbf508ca8dc1b513a1cae4c765271f2c23af6b9528af46610a5d290e7e64c` |
| original-radix-progress-complete          |    0 |             6723 | `7d751aa8cada9ad96f79448247c4022b41983282b46aed6de538693971c55fbe` | `fc31ef83e5bef8b09bc058087b9f0b91cc5d4232244a96f1cbf5798d51685c10` |
| original-radix-progress-finite-extended   |    0 |             9059 | `6aedab30b27406291c2743dc847d1727c35182b9f437a75696a0abebb369e1a7` | `7bc505ee009dabf8769cd5a5029230e34af4e8272400b02a564f13f750f49260` |
| source-function-return-replay-control     |    0 |              579 | `754bb7b502351694809af53fce22af70c1d6f10bc0bd5aa0cb61245e3fc6c0de` | `cceaf9655fc5e7c27fd1526e71360870ed87d8c02e5efcebe8637929d98b7d5e` |
| current-public-controls-corrected         |    0 |              801 | `851ecdddfda92812501cde3d23585ec02ac8f4701e53439d90977e32d8dae615` | `54129176bcbfbb5e2457e532e60f9fe80c283afcd71ed7fcf48d6feb840388b8` |

### Retained helper failures and qualifications

1. Initial `current-public-controls` native adapter appended a semicolon incorrectly for the default export, and omitted native `structuredClone` in its vm context. Those two native anchors were invalid, not product failures. `native-adapter-correction` independently repaired those two controls; `current-public-controls-corrected` subsequently reran the same complete 29-config/two-repeat scope with both corrections (58 current comparisons), no added coverage.
2. `checkpoint-and-replay-boundaries` exited 1 because `dump` threw synchronously before the helper's promise catcher received it. The captured retry wraps the call in `Promise.resolve().then(...)` and records the actual AR-001 rejection; the failed helper is not counted as a completed scenario.
3. Initial `cancellation-pending-lifecycle` used invalid host policy string `read` for O14; public supported strings are `re-issue` and `read-side-effect`. Restore's “Snapshot hostCalls[1].policy is invalid” was a helper setup error, not a product defect. Corrected command uses `re-issue`; original single-input lifecycle now passes. That helper's initial `serializedStable` comparison was tautological and supplies **no** immutability evidence; the corrected receipt instead records actual serialized cleanup=0 versus live view cleanup=1.
4. Both O13 provider branches in the lifecycle receipts are blocked at capture; they never invoke provider/resume. A mirrored capture rejection under the helper's `resumed` field is not a restore result.
5. `original-radix-progress-complete` is only a helper name: both 3-second attempts were incomplete deadline errors. The separate 15-second finite command supplies the sole current complete diagnostic comparison. Its `sourceSha256` field hashes JSON.stringify(source), not raw file bytes; the raw source hash is separately recorded in the input manifest.

### Current native/current outcome matrix

Each line is one configuration, repeated twice in the corrected command. Full source strings, diagnostic collection and bounds are in the inline receipt appendix; named open issues are deliberately still red.

| Configuration               | Native expected                                              | Current actual                                                                       |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| D01-nested-await            | 7                                                            | 7                                                                                    |
| O01-array-callback-mutation | [3,[1,2,3,3]]                                                | api-rejection: reentry — Sandbox object is already running.                          |
| O01-map-callback-mutation   | [1,2]                                                        | api-rejection: reentry — Sandbox object is already running.                          |
| O02-eager-values            | [false,[10,20]]                                              | [true,[10]]                                                                          |
| O03-unicode-flag            | true                                                         | api-rejection: ParseError — Unsupported regex flag 'u' at line 1, column 11.         |
| O03-sticky-flag             | [true,2]                                                     | api-rejection: ParseError — Unsupported regex flag 'y' at line 1, column 20.         |
| O03-lookaround              | true                                                         | api-rejection: ParseError — Lookahead is not supported at line 1, column 17.         |
| O04-switch                  | 7                                                            | 7                                                                                    |
| O07-ordinary-top            | rejection: Error — ordinary                                  | api-rejection: Error — ordinary                                                      |
| O07-ordinary-default        | rejection: Error — ordinary                                  | api-rejection: Error — ordinary                                                      |
| O07-ordinary-await          | rejection: Error — ordinary                                  | api-rejection: Error — ordinary                                                      |
| O09-in-top                  | true                                                         | interpreter-error: UNSUPPORTED_NODE — Binary operator 'in' is not supported.         |
| O09-in-closure              | true                                                         | api-rejection: UNSUPPORTED_NODE — Binary operator 'in' is not supported.             |
| O09-in-await                | true                                                         | interpreter-error: UNSUPPORTED_NODE — Binary operator 'in' is not supported.         |
| O08-callable-configuration  | 3                                                            | api-rejection: TypeError — Assignment expressions require a sandbox object property. |
| O11-constructor-error       | rejection: Error — ordinary                                  | api-rejection: Error — ordinary                                                      |
| U02-keyword-return          | 7                                                            | api-rejection: ParseError — Unexpected token 'return' at line 1, column 20.          |
| SUP03-async-computed        | 7                                                            | api-rejection: ParseError — Expected '}' at line 1, column 24.                       |
| D03-source-generator        | [1,2]                                                        | [1,2]                                                                                |
| O20-cycle-rejection         | rejection: TypeError — Converting circular structure to JSON |

    --> starting at object with constructor 'Object'
    --- property 'self' closes the circle | api-rejection: TypeError — Converting circular structure to JSON. |

| R-ARRAY-own-metadata | [true,7] | [true,{"$undefined":true}] |
| R-NUM001-arity | 2 | {"$undefined":true} |
| R-STR02-no-match | null | [] |
| R-STR04-cursor | 1 | 2 |
| R-OBJ003-from-map | {"value":7} | api-rejection: TypeError — object is not iterable (cannot read property Symbol(Symbol.iterator)) |
| R-LANG01-read-only | 6 | api-rejection: reentry — Sandbox object is already running. |
| R-CTX001-thisarg | [8,12] | api-rejection: TypeError — Cannot read properties of null or undefined. |
| R-AW-source-error-metadata | [true,"RETRY"] | [false,{"$undefined":true}] |
| R-OBJ002-sparse-clone | [2,[]] | api-rejection: TypeError — undefined is not iterable (cannot read property Symbol(Symbol.iterator)) |

### Original alias and replay witnesses

- U01 exact original source: both bindings and entryPointArgs, two repeats each. Native `promiseAlias/sameHandle/sameAlias/markerVisible` all true, value 7. Current `promiseAlias=false, sameHandle=true, sameAlias=false, markerVisible=false`, value 7. No caller prewrapping or workaround replaces this public-boundary failure.
- R10 raw completed input: first returns 7; restore fails `TypeError: Promise replay references work not created at this position.`. Adapted completed control returns 7 on both runs. These are distinct from U01 identity and O14 pre-consumption lifecycle.
- D02, D03, O06, O10, O13 and O14 selected captures/results are recorded in their sections. Checks use fresh current snapshots in memory; no guest files, external service or archived snapshot execution. Retained legacy prewrapped controls are explicitly identified as internal, not mislabeled public API support.

## Read-only source and input manifest

All 23 tracked entries below were SHA-256 hashed and compared byte-for-byte with `git show HEAD:<path>` at the pinned HEAD after execution. Every comparison matched. This manifest pins relevant source/docs, not a guarantee that every path in the repository was dynamically exercised. Dependencies were built from this same checkout.

| Current tracked path                                  | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `AGENTS.md`                                           | `a68ac67735ca1eccdb4cfad1f706a47384a01a446f2555e6d01b4726e2830fd7` |
| `package-lock.json`                                   | `297af2f85db1eeedaca7a33f64a4ec95bed39754d42a1e787a236c4af55c29c7` |
| `packages/safejs/package.json`                        | `d7111e27a6554a9c1cf2d4a0323595d4f161b0d66450c79fcfc09ccf7cd6990f` |
| `packages/safejs/README.md`                           | `856e18584c356edf97099a0002d2273eb5710b97ca85ef5e32326dbe944bc937` |
| `packages/safejs/CHECKPOINT_REPLAY.md`                | `bb09f01b62cb4d9fe0a159caabc78399ddafedd78b191e5e672896e223ecce6f` |
| `packages/safejs/src/templates/skill/SKILL_safejs.md` | `11b5f28a9efa75f35545bcc9ef02bb83964a22485224fe7934a440101d1bb973` |
| `packages/safejs/src/index.ts`                        | `35e6ea7aa5730121c9d31ed4153347ee0056bbe048c909fd308e576596f30989` |
| `packages/safejs/src/core.ts`                         | `8be80dabb023c6f260973b7ac78db7a1405b48f55118d384182eaa081e7eff0a` |
| `packages/safejs/src/run.ts`                          | `34921c73d860114824156aebab2ccf2f18b2429106782dd7929de5c3b4bbdf79` |
| `packages/safejs/src/dump.ts`                         | `54669688832ebdab92228cc984e2129dab9ba358ca0fb6f1dcf542d432529e8f` |
| `packages/safejs/src/restore.ts`                      | `20eb53527236ca8c0c6a6788abbba9644f8816d562625f86f14c7e95cff243db` |
| `packages/safejs/src/interp/interpreter.ts`           | `33f52089f7631fc115104dff9de3cc405689a1537d4c0e82d13cd07c4272a22a` |
| `packages/safejs/src/interp/values.ts`                | `487d392c295977bdd144713382e5ab142d85a3dfac27a8fe9cfea8c669dbbf75` |
| `packages/safejs/src/interp/host-call.ts`             | `1f8bec1f24ddd58f343b6a314f8deff05ef4c67dd879ca82ce523186ca84a6cc` |
| `packages/safejs/src/interp/host-bridge.ts`           | `8bc1c6cb653fa70d281732d7bb893a02cfd0e6a87f6eff093d448b9d56678420` |
| `packages/safejs/src/snapshot/policy.ts`              | `7306c1f3c1170a0bdde41fb56ac943e07dffa1a69fed46faec538f459ae56a33` |
| `packages/safejs/src/snapshot/serialize.ts`           | `34c74ba5f75a9ad8a29f1adc034820c37e2b3778b258660d24de6c54a520f7b6` |
| `packages/safejs/src/snapshot/backend.ts`             | `55fe58a47a8a623a957d3cdcc40ed922db35d2cdede0f97d38e3eba34ebe70f1` |
| `packages/safejs/src/snapshot/scheduler.ts`           | `616c06660d9ee884f3b79c5d0843a255376e1fa441620a803205eb680e28c2fc` |
| `packages/safejs/src/interp/methods/array.ts`         | `ceb6b56cbda6085a8c49496cc4f289de877ade4279d42fa9e82fbb0f9b5771a2` |
| `packages/safejs/src/interp/methods/string.ts`        | `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b` |
| `packages/safejs/src/interp/globals/object-array.ts`  | `b8a4b6f0adc702ba489e7f513e4a351a858a35a7edb06354df288f5876391e44` |
| `packages/safejs/src/lint/rules/known-globals.ts`     | `d46ffec37691edf3a01a8a2a4d8bc8a8f91bac59f0f55737b3350eb89167917a` |

The following is the complete bootstrap/payload/master/getter/installed-skill read manifest for this sidecar. Audit reads used only guarded paths; publisher and other-clone evidence were read-only. Candidate manifest pointers in the dependency table are attributed reports, not extra reads. Paths are relative to this clone where possible.

| Read-only path                                                                                                                                                                                   | SHA-256                                                            | Role                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `../poe-code/out/safejs-audit-2026-08-27/inventory-verification.json`                                                                                                                            | `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827` | bootstrap                                                                         |
| `../poe-code/out/safejs-audit-2026-08-27/REPORT.md`                                                                                                                                              | `40d467e72bd741dfeaa5c6b776c3d2cc7dc61d622e0e08419c05506c2c428fb1` | allowlisted functional audit                                                      |
| `../poe-code/out/safejs-audit-2026-08-27/inventory.json`                                                                                                                                         | `00ca8535d28a90d9bc0810090db149a91491a6ed1048d8e55c75fa7d3f78a822` | allowlisted functional audit                                                      |
| `../poe-code-safejs-publish/docs/plans/safejs-audit-remediation.md`                                                                                                                              | `e86c0278562bb25331122eee0e7f18abbb392019a516009d49a9f1c23db25b59` | publisher-owned ledger read-only                                                  |
| `../poe-code-safejs-array-metadata/out/safejs-remediation/array-own-metadata-validation/revalidation-call-order/candidate-051cfa0474bd5d62/evidence/REVALIDATION.md`                             | `b39ae5f6494a46e7ffe0beee519ae5147aa64edf6a9ac99245c09f1328efa3bc` | functional getter observation read-only                                           |
| `../poe-code-safejs-array-metadata/out/safejs-remediation/array-own-metadata-validation/revalidation-call-order/candidate-051cfa0474bd5d62/evidence/enumerable-host-getter-observation.json`     | `a7e58f122c33d16479893144e87cdf6336991b4b10dbc37220bc0a993cf875d0` | getter functional evidence                                                        |
| `../poe-code-safejs-array-metadata/out/safejs-remediation/array-own-metadata-validation/revalidation-call-order/candidate-051cfa0474bd5d62/evidence/enumerable-host-getter-base-comparison.json` | `7d747d1e11076a4fa1b2826c06729068cbf7cbe65ad4245764bc52f30ad78b98` | getter functional evidence                                                        |
| `../poe-code-safejs-array-metadata/out/safejs-remediation/array-own-metadata-validation/revalidation-call-order/candidate-051cfa0474bd5d62/evidence/pending-followups.json`                      | `b03e184d2a283e35e795948c05fd31032c7c96ef8fec97db9e8971a8f3e5f7ca` | getter functional evidence                                                        |
| `../poe-code/out/safejs-audit-2026-08-27/async-replay/reductions/10-external-dump.js`                                                                                                            | `7ca76d186abe3c3245fe811d7652e7d4d04cd528c47f401555543cd4eb038af3` | allowlisted functional audit                                                      |
| `../poe-code/out/safejs-audit-2026-08-27/public-promise-recovery/02-public-promise-alias-control.ajs`                                                                                            | `784f6eb021150c6c0d83365061cea4db1cc53d2504e643900aff633d178347be` | allowlisted functional audit                                                      |
| `../poe-code/out/safejs-audit-2026-08-27/indexed-structures/cases/radix-progress.ajs`                                                                                                            | `323143410a42633f9943b303444b42a9fa1828d9df6ab0e6c422a761604c8f0a` | allowlisted functional audit                                                      |
| `../poe-code/out/safejs-audit-2026-08-27/public-promise-adaptation/single-gate-assessment.json`                                                                                                  | `72dc0bcfd1570d912a0d2cda0019523ca1adcc576cc91b700cbc21cc8b91e1dd` | allowlisted functional audit                                                      |
| `../poe-code/out/safejs-audit-2026-08-27/public-promise-adaptation/03-single-public-input-recovery.ajs`                                                                                          | `21004b9bd197084cdfc54b678a69094d9fc2ca776710fd773f57c6bef753c1a8` | allowlisted functional audit                                                      |
| `../poe-code/out/safejs-audit-2026-08-27/indexed-structures/results.json`                                                                                                                        | `c50cce0219de4b2d669d969b12cafee00236d4e3bcb7d7504f28ec1a68a42896` | allowlisted functional audit                                                      |
| `../poe-code/out/safejs-audit-2026-08-27/public-promise-adaptation/results.json`                                                                                                                 | `9b019bc413f3dcda67e9aec07137c40e7da45107473f64b051b11477318c03ba` | allowlisted functional audit                                                      |
| `../poe-code/out/safejs-audit-2026-08-27/indexed-structures/fixtures.json`                                                                                                                       | `fa6aa4711216f683d9e2b6b7de6bd291fe677573545f15037deb0d478c32b039` | allowlisted functional audit                                                      |
| `../poe-code/out/safejs-audit-2026-08-27/SNIPPETS.md`                                                                                                                                            | `b4b9808508100bbe836792e11e9e2d8ee7fc4ace10b6650ae6ee5704e8b5fb41` | allowlisted functional audit                                                      |
| `../../.agents/skills/poe-code-safejs/SKILL.md`                                                                                                                                                  | `11b5f28a9efa75f35545bcc9ef02bb83964a22485224fe7934a440101d1bb973` | read-only installed instruction skill; this copy agrees on nested top-level await |

## Independent validator handoff (Markdown QA plan)

1. Read ancestor/root instructions; work in a separate main checkout, pull successfully first, record its exact base. Do not edit this worker's checkout, the publisher master, original audit, or other frozen lanes. Compare against the pinned base before interpreting differences.
2. Bootstrap the exact 38 exclusions from the permitted verification metadata **before** any original payload; exclude all security/ and outside-cohort paths. Use the allowlisted manifest above, never recursive out discovery or excluded-file hash probes.
3. Verify 47 unique scope rows, 21 ranked groups/23 IDs, all O01–O21 and D01–D03, both U rows, 128 FAIL mappings, 17 unresolved mappings, and 30 review-only configurations/93 historical children. Validate original pointer IDs, not just sums. G01/supplemental companions do not rewrite the original census.
4. Independently exercise the selected current public/native controls; prioritize G01 public-vs-internal boundary, source-generator capture D03, live-vs-serialized O10, and pre-consumption O14. Treat ordinary host functions, public Promise adapters and legacy prewrapped internals as separate fixtures. Preserve exact prior helper errors and performance limits.
5. Confirm documentation statements against public README/template/CHECKPOINT_REPLAY and exports; do not mark an exclusion documented merely because an interpreter branch rejects it. Do not close a derived contract mismatch merely for lacking an express promise.
6. For O05/O12/O13/O14, either produce the specific valid current proof/chain evidence requested above on the approved integrated base, or retain the narrow remaining validation ask. Neither a returned proof nor the old report establishes consumption/current success. No implementation or full-suite expansion belongs to this disposition review.
7. Report ACCEPT/changes-needed with independently checked document/source hashes and exact scope qualifications. Parent associates remaining asks with frozen owners; publisher alone integrates approved plans with relevant fixes and observes actual publication, not merely green/skipped Release checks.

No unresolved question requires immediate user input to complete this inventory. Product decisions about expanding intentionally limited syntax or internal descriptor support are explicit future owner decisions, not permission to silently close observations. The original functional scope is retained.

## Inline receipt appendix

These are finite **inline commands**, not executable QA files or a replacement for the Markdown review steps. Run from the isolated root using `node --import tsx --input-type=module <<'JS'`, paste one listed body, then `JS`. Do not run extracted audit scripts, archived wrappers or excluded inputs. Most bodies are verbatim actual stdin; the long original radix body is referenced by its guarded source read rather than copied here. Output stays in memory/terminal; no guest IO capabilities are supplied.

### Current public controls (corrected)

<!-- prettier-ignore -->
```js
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {run, lint, Budget, dump, restore, deepCopyToSandbox} from './packages/safejs/src/index.ts';
const encode = value => value === undefined ? {$undefined:true} : typeof value === 'number' && !Number.isFinite(value) ? {$number:String(value)} : Array.isArray(value) ? Array.from(value, encode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)])) : value;
const describe = error => ({name:error?.name, message:error?.message, code:error?.code});
const options = () => ({budget:new Budget({maxSteps:50000,maxCallDepth:64,arrayLength:4096,stringLength:32768,dataSize:2097152,deadline:Date.now()+1000})});

const cases = [{"id":"D01-nested-await","row":"D01","source":"{ const value = await Promise.resolve(7); return value; }"},{"id":"O01-array-callback-mutation","row":"O01","source":"const values = [1,2]; const result = values.reduce((sum, value) => { values.push(3); return sum + value; }, 0); return [result, values];"},{"id":"O01-map-callback-mutation","row":"O01","source":"const values = new Map([[1,10]]); const seen = []; values.forEach((value,key) => { seen.push(key); if (key === 1) values.set(2,20); }); return seen;"},{"id":"O02-eager-values","row":"O02","source":"const values = new Map([[1,10]]); const listed = values.values(); values.set(2,20); return [Array.isArray(listed), Array.from(listed)];"},{"id":"O03-unicode-flag","row":"O03","source":"return /a/u.test(\"a\");"},{"id":"O03-sticky-flag","row":"O03","source":"const pattern = /a/y; pattern.lastIndex = 1; return [pattern.test(\"ba\"), pattern.lastIndex];"},{"id":"O03-lookaround","row":"O03","source":"return /a(?=b)/.test(\"ab\");"},{"id":"O04-switch","row":"O04","source":"let answer = 0; switch (2) { case 2: answer = 7; break; default: answer = -1; } return answer;"},{"id":"O07-ordinary-top","row":"O07","source":"throw Error(\"ordinary\");"},{"id":"O07-ordinary-default","row":"O07","source":"export default () => { throw Error(\"ordinary\"); };","entry":true},{"id":"O07-ordinary-await","row":"O07","source":"async function fail() { throw Error(\"ordinary\"); } return await fail();"},{"id":"O09-in-top","row":"O09","source":"return \"value\" in {value: 7};"},{"id":"O09-in-closure","row":"O09","source":"function check() { return \"value\" in {value: 7}; } return check();"},{"id":"O09-in-await","row":"O09","source":"async function check() { return \"value\" in {value: 7}; } return await check();"},{"id":"O08-callable-configuration","row":"O08","source":"function configured() { return 7; } configured.option = 3; return configured.option;"},{"id":"O11-constructor-error","row":"O11","source":"throw new Error(\"ordinary\");"},{"id":"U02-keyword-return","row":"U02","source":"const iterator = { return() { return 7; } }; return iterator.return();"},{"id":"SUP03-async-computed","row":"SUP03","source":"const object = { async [\"read\"]() { return 7; } }; return await object.read();"},{"id":"D03-source-generator","row":"D03","source":"function* values() { yield 1; yield 2; } const iterator = values(); const first = iterator.next().value; await Promise.resolve(0); return [first, iterator.next().value];"},{"id":"O20-cycle-rejection","row":"O20","source":"const value = {}; value.self = value; return JSON.stringify(value);"},{"id":"R-ARRAY-own-metadata","row":"ARRAY-OWN-METADATA","source":"const values = []; values.metadata = 7; return [Object.hasOwn(values,\"metadata\"), values.metadata];"},{"id":"R-NUM001-arity","row":"NUM-001","source":"return (function(first,second) {}).length;"},{"id":"R-STR02-no-match","row":"STR-02","source":"return \"abc\".match(/z/g);"},{"id":"R-STR04-cursor","row":"STR-04","source":"const pattern = /a/g; pattern.lastIndex = 2; return Array.from(\"aba\".matchAll(pattern)).length;"},{"id":"R-OBJ003-from-map","row":"OBJ-003","source":"return Object.fromEntries(new Map([[\"value\",7]]));"},{"id":"R-LANG01-read-only","row":"LANG-01","source":"const values = [1,2]; return values.reduce((sum,value) => sum + values.reduce((inner,item) => inner + item,0),0);"},{"id":"R-CTX001-thisarg","row":"CTX-001","source":"return [2,3].map(function(value) { return value * this.scale; }, {scale: 4});"},{"id":"R-AW-source-error-metadata","row":"SOURCE-EXCEPTION-COERCION","source":"const reason = {name:\"Error\",message:\"retry\",code:\"RETRY\"}; async function fail() { throw reason; } try { await fail(); } catch (caught) { return [caught === reason, caught.code]; }"},{"id":"R-OBJ002-sparse-clone","row":"OBJ-002","source":"const values = Array(2); const copy = structuredClone(values); return [copy.length,Object.keys(copy)];"}];
const results = [];
for (const item of cases) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const source = item.source;
    let native;
    try {
      let entryBody = item.entry ? source.slice('export default '.length).trim() : source; if(item.entry && entryBody.endsWith(';')) entryBody = entryBody.slice(0,-1); const nativeBody = item.entry ? 'return (' + entryBody + ')();' : source;
      native = {kind:'value', value:encode(await vm.runInNewContext('(async()=>{'+nativeBody+'})()',{structuredClone}, {timeout:1000}))};
    } catch(error) {native={kind:'rejection',error:describe(error)};}
    let diagnostics;
    try {diagnostics=lint(source).map(({code,severity,line,column})=>({code,severity,line,column}));}catch(error){diagnostics={error:describe(error)};}
    let actual;
    try {
      const result=await run(source,{...options(),...(item.entry?{entryPointArgs:[]}: {})});
      actual=result.ok?{kind:'value',value:encode(result.returnValue),steps:result.stats.nodeVisits}:{kind:'interpreter-error',error:describe(result.error)};
    } catch(error){actual={kind:'api-rejection',error:describe(error)};}
    results.push({id:item.id,row:item.row,attempt,source,diagnostics,native,actual});
  }
}
console.log(JSON.stringify({date:new Date().toISOString(),results},null,2));
```

### G01 functional getter boundaries

<!-- prettier-ignore -->
```js
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {run, lint, Budget, dump, restore, deepCopyToSandbox} from './packages/safejs/src/index.ts';
const encode = value => value === undefined ? {$undefined:true} : typeof value === 'number' && !Number.isFinite(value) ? {$number:String(value)} : Array.isArray(value) ? Array.from(value, encode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)])) : value;
const describe = error => ({name:error?.name, message:error?.message, code:error?.code});
const options = () => ({budget:new Budget({maxSteps:50000,maxCallDepth:64,arrayLength:4096,stringLength:32768,dataSize:2097152,deadline:Date.now()+1000})});

import {interpret} from './packages/safejs/src/interp/interpreter.ts';
import {parseModule} from './packages/safejs/src/parse/parser.ts';
import {createSandboxClosure} from './packages/safejs/src/interp/values.ts';
const results=[];
for(const enumerable of [true,false])for(const optional of [false,true])for(let attempt=1;attempt<=2;attempt++){
  const source='let current = target; function receiver() { trace.push("receiver"); return current; } function key() { trace.push("key"); return "method"; } function argument() { trace.push("argument"); current = {value:100}; return 3; } let result; try { result = receiver()[key()]'+(optional?'?.':'')+'(argument()); } catch(error) { result = error.name; } return [result,trace.slice(),current.value];';
  function fixture(sandbox){const trace=[];const target={value:7};let reads=0;Object.defineProperty(target,'method',{enumerable,get(){trace.push('get');reads++;if(optional)return null;return sandbox?createSandboxClosure({name:'captured',sandbox:true,call:(args,context)=>{trace.push('call');return reads===1?context.thisValue.value+args[0]:-1;}}):function(value){trace.push('call');return reads===1?this.value+value:-1;};}});return {target,trace};}
  const nativeBindings=fixture(false);
  const native=vm.runInNewContext('(function(){'+source+'})()',nativeBindings,{timeout:1000});
  const internalBindings=fixture(true);
  const internal=await interpret({...parseModule(source),type:'BlockStatement'},{bindings:internalBindings,budget:options().budget});
  const publicBindings=fixture(false);let publicResult;
  try{const result=await run(source,{...options(),bindings:publicBindings});publicResult=result.ok?{kind:'value',value:encode(result.returnValue)}:{kind:'interpreter-error',error:describe(result.error)};}catch(error){publicResult={kind:'api-rejection',error:describe(error)};}
  results.push({id:'G01-host-getter',attempt,enumerable,optional,source,native:encode(native),internal:internal.ok?encode(internal.returnValue):describe(internal.error),publicResult,publicGetterReads:publicBindings.trace.filter(item=>item==='get').length});
}
for(const boundary of ['deepCopyToSandbox','host-result']){
  const trace=[];const target={};Object.defineProperty(target,'value',{enumerable:true,get(){trace.push('get');return 7;}});let result;
  try{if(boundary==='deepCopyToSandbox'){result={kind:'value',value:deepCopyToSandbox(target)};}else{const runResult=await run('import {provide} from "host"; return (await provide()).value;',{...options(),modules:{host:{provide:()=>target}}});result=runResult.ok?{kind:'value',value:runResult.returnValue}:{kind:'interpreter-error',error:describe(runResult.error)};}}catch(error){result={kind:'rejection',error:describe(error)};}
  results.push({id:'G01-public-boundary',boundary,result,trace});
}
console.log(JSON.stringify({date:new Date().toISOString(),results},null,2));
```

### Checkpoint/replay timing (captured)

<!-- prettier-ignore -->
```js
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {run, lint, Budget, dump, restore, deepCopyToSandbox} from './packages/safejs/src/index.ts';
const encode = value => value === undefined ? {$undefined:true} : typeof value === 'number' && !Number.isFinite(value) ? {$number:String(value)} : Array.isArray(value) ? Array.from(value, encode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)])) : value;
const describe = error => ({name:error?.name, message:error?.message, code:error?.code});
const options = () => ({budget:new Budget({maxSteps:50000,maxCallDepth:64,arrayLength:4096,stringLength:32768,dataSize:2097152,deadline:Date.now()+1000})});

import {dumpCurrent} from './packages/safejs/src/dump.ts';
import {createSandboxClosure,createSandboxPromise} from './packages/safejs/src/interp/values.ts';
const results=[];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const observe=async promise=>{let timer;try{return await Promise.race([promise.then(value=>({kind:'value',value}),error=>({kind:'rejection',error:describe(error)})),new Promise(done=>{timer=setTimeout(()=>done({kind:'pending-at-80ms'}),80);})]);}finally{clearTimeout(timer);}};
const brief=result=>result.ok?{ok:true,value:encode(result.returnValue),steps:result.stats.nodeVisits}:{ok:false,error:describe(result.error)};
for(const mode of ['plain','prewrapped']){
 const started=deferred(),held=deferred();
 const source='const first = await lookup(2);\nconst final = await checkpoint("hold");\nreturn { first, final };\n';
 const lookup=mode==='plain'?async value=>value*10:createSandboxClosure({name:'lookup',async:true,call:([value])=>createSandboxPromise(Promise.resolve(value*10))});
 const checkpoint=mode==='plain'?async()=>{started.resolve();return held.promise;}:createSandboxClosure({name:'checkpoint',async:true,call:()=>{started.resolve();return createSandboxPromise(held.promise);}});
 const pending=run(source,{...options(),bindings:{lookup,checkpoint}});pending.catch(()=>{});
 await started.promise;
 const current=await observe(Promise.resolve().then(()=>dumpCurrent(pending)));
 const nextPromise=Promise.resolve().then(()=>dump(pending));nextPromise.catch(()=>{});const next=await observe(nextPromise);
 held.resolve(13);const final=await observe(pending);const nextAfterRelease=await observe(nextPromise);
 results.push({id:'D02-AR001-dump-timing',mode,current:current.kind==='value'?{kind:'snapshot',bytes:current.value.length}:current,nextWhileHeld:next,nextAfterRelease:nextAfterRelease.kind==='value'?{kind:'snapshot',bytes:nextAfterRelease.value.length}:nextAfterRelease,final:final.kind==='value'?brief(final.value):final});
}
for(const mode of ['plain','prewrapped']){
 let calls=0;const source='return await read();';
 const makeRead=()=>mode==='plain'?async()=>{calls++;return 7;}:createSandboxClosure({name:'read',async:true,call:()=>{calls++;return createSandboxPromise(Promise.resolve(7));}});
 const first=await run(source,{...options(),bindings:{read:makeRead()}});const firstCalls=calls;
 try{const snapshot=restore(JSON.parse(await dump(first)),{source});const second=await run(source,{...options(),bindings:{read:makeRead()},snapshot});results.push({id:'O06-prewrapped-replay',mode,first:brief(first),second:brief(second),firstCalls,finalCalls:calls});}catch(error){results.push({id:'O06-prewrapped-replay',mode,first:brief(first),firstCalls,finalCalls:calls,error:describe(error)});}
}
{
 const source='function* values() { yield 1; yield 2; } const iterator = values(); const first = iterator.next().value; await wait(); return [first,iterator.next().value];';
 const held=deferred();const makeWait=promise=>createSandboxClosure({name:'wait',async:true,call:()=>createSandboxPromise(promise)});
 const pending=run(source,{...options(),bindings:{wait:makeWait(held.promise)}});pending.catch(()=>{});
 const captured=await observe(Promise.resolve().then(()=>dump(pending)));held.resolve(0);const first=await pending;
 let resumed;
 try{resumed=captured.kind==='value'?brief(await run(source,{...options(),bindings:{wait:makeWait(Promise.resolve(0))},snapshot:restore(JSON.parse(captured.value),{source})})):captured;}catch(error){resumed={error:describe(error)};}
 results.push({id:'D03-suspended-source-generator-checkpoint',first:brief(first),captured:captured.kind==='value'?{kind:'snapshot',bytes:captured.value.length}:captured,resumed,expected:[1,2],qualification:'Prewrapped legacy wait isolates source generator capture from AR-001 ordinary pending-host-call failure'});
}
for(const adaptation of ['raw','deepCopyToSandbox']){
 const source='const value = await input; return value;';const promise=Promise.resolve(7);const input=adaptation==='raw'?promise:deepCopyToSandbox(promise);
 const first=await run(source,{...options(),bindings:{input}});let resumed;
 try{const snapshot=restore(JSON.parse(await dump(first)),{source});const second=await run(source,{...options(),snapshot});resumed={...brief(second),lifecycle:second.snapshot?.replay?.calls?.map(({moduleId,operation,lifecycle})=>({moduleId,operation,lifecycle}))};}catch(error){resumed={error:describe(error)};}
 results.push({id:adaptation==='raw'?'PPR002-current-completed':'O14-adapted-completed-lifecycle',adaptation,first:{...brief(first),lifecycle:first.snapshot?.replay?.calls?.map(({moduleId,operation,lifecycle})=>({moduleId,operation,lifecycle}))},resumed});
}
console.log(JSON.stringify({date:new Date().toISOString(),results},null,2));
```

### Original public Promise alias

<!-- prettier-ignore -->
```js
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {run, lint, Budget, dump, restore, deepCopyToSandbox} from './packages/safejs/src/index.ts';
const encode = value => value === undefined ? {$undefined:true} : typeof value === 'number' && !Number.isFinite(value) ? {$number:String(value)} : Array.isArray(value) ? Array.from(value, encode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)])) : value;
const describe = error => ({name:error?.name, message:error?.message, code:error?.code});
const options = () => ({budget:new Budget({maxSteps:50000,maxCallDepth:64,arrayLength:4096,stringLength:32768,dataSize:2097152,deadline:Date.now()+1000})});

const source="export default async fixture => {\n  const input = fixture === undefined ? incoming : fixture;\n  const promiseAlias = input.primary === input.again;\n  const first = await input.primary;\n  const repeated = await input.primary;\n  first.seen = true;\n  const alias = await input.again;\n  return {\n    promiseAlias,\n    value: first.value,\n    sameHandle: first === repeated,\n    sameAlias: first === alias,\n    markerVisible: alias.seen === true\n  };\n};\n";

const results=[];
for(const mode of ['bindings','entryPointArgs'])for(let attempt=1;attempt<=2;attempt++){
 const nativePromise=Promise.resolve({value:7});const nativeInput={primary:nativePromise,again:nativePromise};
 const expression=source.slice('export default '.length).trimEnd().slice(0,-1);
 const native=await vm.runInNewContext('('+expression+')(fixture)',{incoming:nativeInput,fixture:mode==='bindings'?undefined:nativeInput},{timeout:1000});
 const promise=Promise.resolve({value:7});const input={primary:promise,again:promise};
 try{const result=await run(source,{...options(),bindings:mode==='bindings'?{incoming:input}:{},entryPointArgs:mode==='bindings'?[]:[input]});results.push({id:'U01-original-promise-alias',mode,attempt,native:encode(native),actual:result.ok?encode(result.returnValue):describe(result.error)});}catch(error){results.push({id:'U01-original-promise-alias',mode,attempt,native:encode(native),error:describe(error)});}
}
console.log(JSON.stringify({date:new Date().toISOString(),results},null,2));
```

### Cancellation/pending/lifecycle (corrected)

<!-- prettier-ignore -->
```js
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {run, lint, Budget, dump, restore, deepCopyToSandbox} from './packages/safejs/src/index.ts';
const encode = value => value === undefined ? {$undefined:true} : typeof value === 'number' && !Number.isFinite(value) ? {$number:String(value)} : Array.isArray(value) ? Array.from(value, encode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)])) : value;
const describe = error => ({name:error?.name, message:error?.message, code:error?.code});
const options = () => ({budget:new Budget({maxSteps:50000,maxCallDepth:64,arrayLength:4096,stringLength:32768,dataSize:2097152,deadline:Date.now()+1000})});

import {createSandboxClosure,createSandboxPromise} from './packages/safejs/src/interp/values.ts';
import {serializeSafeJSSnapshot} from './packages/safejs/src/dump.ts';
import {declareHostOperation} from './packages/safejs/src/index.ts';
const results=[];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const observe=async promise=>{let timer;try{return await Promise.race([Promise.resolve(promise).then(value=>({kind:'value',value}),error=>({kind:'rejection',error:describe(error)})),new Promise(done=>{timer=setTimeout(()=>done({kind:'pending-at-80ms'}),80);})]);}finally{clearTimeout(timer);}};
const brief=result=>result.ok?{ok:true,value:encode(result.returnValue),steps:result.stats.nodeVisits}:{ok:false,error:describe(result.error)};
{
 const source='const state = {cleanup:0}; try { try { await wait(); } finally { state.cleanup += 1; } } catch(error) {} return state.cleanup;';
 const held=deferred(),started=deferred(),controller=new AbortController(),captures=[];
 const wait=createSandboxClosure({name:'wait',async:true,call:()=>{started.resolve();return createSandboxPromise(held.promise);}});
 const pending=run(source,{...options(),bindings:{wait},signal:controller.signal,snapshotIntervalMs:1,snapshotBackend:{async read(){return undefined;},async remove(){},async write(snapshot){captures.push({snapshot,serialized:serializeSafeJSSnapshot(snapshot),before:encode(snapshot.bindings?.state)});}}});pending.catch(()=>{});
 await started.promise;
 const explicit=await observe(Promise.resolve().then(()=>dump(pending)));
 await new Promise(done=>setImmediate(done));
 controller.abort(new Error('controlled-cancel'));held.resolve(0);
 const final=await observe(pending);
 let resumed;
 if(explicit.kind==='value')resumed=await observe(run(source,{...options(),bindings:{wait:createSandboxClosure({name:'wait',async:true,call:()=>createSandboxPromise(Promise.resolve(0))})},snapshot:restore(JSON.parse(explicit.value),{source})}));
 results.push({id:'O10-current-cancellation-view',source,final:final.kind==='value'?brief(final.value):final,captures:captures.map(item=>({before:item.before,after:encode(item.snapshot.bindings?.state),serializedStateBefore:encode(JSON.parse(item.serialized).bindings?.state)})),serializedResume:resumed?.kind==='value'?brief(resumed.value):resumed,qualification:'Selected serialized checkpoint and view observation; not a rerun of all six original cancellation profiles'});
}
{
 const source='return await input;';const held=deferred();const pending=run(source,{...options(),bindings:{input:held.promise}});pending.catch(()=>{});
 const captured=await observe(Promise.resolve().then(()=>dump(pending)));held.resolve(7);const first=await pending;
 for(const provider of [false,true]){
  const requests=[];let resumed;
  if(captured.kind==='value'){
   const controller=new AbortController();const replay=run(source,{...options(),signal:controller.signal,snapshot:restore(JSON.parse(captured.value),{source}),...(provider?{hostCallResumeProvider:request=>{requests.push({callId:request.callId,moduleId:request.moduleId,operation:request.operation});return {callId:request.callId,sourceHash:request.sourceHash,moduleId:request.moduleId,operation:request.operation,argumentDigest:request.argumentDigest,outcome:{status:'fulfilled',value:7}};}}:{})});replay.catch(()=>{});resumed=await observe(replay);if(resumed.kind==='pending-at-80ms'){controller.abort(new Error('bounded-validation-stop'));await observe(replay);}
  }else resumed=captured;
  results.push({id:'O13-raw-pending-minimal',provider,capture:captured.kind==='value'?{kind:'snapshot',bytes:captured.value.length}:captured,first:brief(first),resumed:resumed.kind==='value'?brief(resumed.value):resumed,requests,qualification:'Minimal pending control only; not the eight historical full-workflow watchdogs or proof-consumption certification'});
 }
}

{ const source="export default async fixture => {\n  await boundary('before');\n  const first = await fixture.input;\n  const repeated = await fixture.input;\n  return { value: first.value, sameHandle: first === repeated };\n};\n";

 const captures=[];const boundary=declareHostOperation(async label=>{await new Promise(done=>setTimeout(done,5));return label;},'re-issue');
 const input=deepCopyToSandbox(Promise.resolve({value:7}));
 const first=await run(source,{...options(),bindings:{boundary},entryPointArgs:[{input}],snapshotIntervalMs:1,snapshotBackend:{async read(){return undefined;},async remove(){},async write(snapshot){captures.push(JSON.parse(serializeSafeJSSnapshot(snapshot)));}}});
 const captured=captures.find(snapshot=>snapshot.replay?.calls?.some(call=>call.moduleId==='<inputs>'&&call.lifecycle==='settled'));
 const view=snapshot=>snapshot?.replay?.calls?.filter(call=>call.moduleId==='<inputs>').map(({operation,lifecycle})=>({operation,lifecycle}));
 let resumed;
 try{if(captured){const second=await run(source,{...options(),bindings:{boundary:declareHostOperation(async label=>label,'re-issue')},entryPointArgs:[],snapshot:restore(captured,{source})});resumed={...brief(second),lifecycle:view(second.snapshot)};}else resumed={notCaptured:true};}catch(error){resumed={error:describe(error)};}
 results.push({id:'O14-original-single-settled-capture',source,first:{...brief(first),lifecycle:view(first.snapshot)},snapshots:captures.length,capturedLifecycle:view(captured),resumed});
}
console.log(JSON.stringify({date:new Date().toISOString(),results},null,2));
```

### Ordinary source-function return/replay

<!-- prettier-ignore -->
```js
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {run, lint, Budget, dump, restore, deepCopyToSandbox} from './packages/safejs/src/index.ts';
const encode = value => value === undefined ? {$undefined:true} : typeof value === 'number' && !Number.isFinite(value) ? {$number:String(value)} : Array.isArray(value) ? Array.from(value, encode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)])) : value;
const describe = error => ({name:error?.name, message:error?.message, code:error?.code});
const options = () => ({budget:new Budget({maxSteps:50000,maxCallDepth:64,arrayLength:4096,stringLength:32768,dataSize:2097152,deadline:Date.now()+1000})});

let calls=0;const source='const original = value => value + 1; const returned = await relay(original); return [returned === original, returned(6)];';const relay=async callback=>{calls++;return callback;};const results=[];for(let attempt=1;attempt<=2;attempt++){calls=0;try{const first=await run(source,{...options(),bindings:{relay}});const snapshot=await dump(first);const second=await run(source,{...options(),bindings:{relay},snapshot:restore(JSON.parse(snapshot),{source})});results.push({attempt,first:encode(first.returnValue),second:encode(second.returnValue),calls,qualification:'Completed ordinary host return only; not external proof carrying a function'});}catch(error){results.push({attempt,error:describe(error),calls});}}console.log(JSON.stringify({date:new Date().toISOString(),results},null,2));
```

### Original radix diagnostic, equivalent guarded replay recipe

The actual executed stdin embedded the exact source/fixture already read through the bootstrap guard. To avoid copying the 323-line historical source into Git, this equivalent recipe rereads only the two hashed allowlisted inputs. It was assembled for independent reproduction, **not executed as an additional child**; the actual 15-second command fingerprint remains in the receipt table. To reproduce the two incomplete observations, change only deadline to 3,000ms and repeat count to 2. Do not remove the finite step/time bounds.

<!-- prettier-ignore -->
```js
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash as sourceHash} from 'node:crypto';
const originalRoot = path.resolve('../poe-code');
const auditRoot = path.join(originalRoot,'out/safejs-audit-2026-08-27');
const metadataBytes = await readFile(path.join(auditRoot,'inventory-verification.json'));
const sha256 = bytes => sourceHash('sha256').update(bytes).digest('hex');
if (sha256(metadataBytes) !== '2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827') throw Error('Bootstrap changed: reconcile first');
const exclusions = JSON.parse(metadataBytes).archiveReadPolicy.excludedPaths;
if (exclusions.length !== 38) throw Error('Unexpected exclusion count');
const excluded = new Set(exclusions.map(relative => path.resolve(originalRoot,relative)));
const allowed = new Map([['indexed-structures/cases/radix-progress.ajs','323143410a42633f9943b303444b42a9fa1828d9df6ab0e6c422a761604c8f0a'],['indexed-structures/fixtures.json','fa6aa4711216f683d9e2b6b7de6bd291fe677573545f15037deb0d478c32b039']]);
async function readAllowed(relative) {
 const absolute = path.resolve(auditRoot,relative);
 if (!allowed.has(relative) || !absolute.startsWith(auditRoot+path.sep) || excluded.has(absolute) || absolute.startsWith(path.join(auditRoot,'security')+path.sep) || absolute.startsWith(path.join(auditRoot,'dynamic-deflate-provenance-review')+path.sep)) throw Error('Not allowlisted');
 const bytes=await readFile(absolute);if(sha256(bytes)!==allowed.get(relative))throw Error('Historical input changed');return bytes.toString('utf8');
}
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {run, lint, Budget, dump, restore, deepCopyToSandbox} from './packages/safejs/src/index.ts';
const encode = value => value === undefined ? {$undefined:true} : typeof value === 'number' && !Number.isFinite(value) ? {$number:String(value)} : Array.isArray(value) ? Array.from(value, encode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)])) : value;
const describe = error => ({name:error?.name, message:error?.message, code:error?.code});
const options = () => ({budget:new Budget({maxSteps:50000,maxCallDepth:64,arrayLength:4096,stringLength:32768,dataSize:2097152,deadline:Date.now()+1000})});

import {createHash} from 'node:crypto';
const source=await readAllowed('indexed-structures/cases/radix-progress.ajs');
const fixture=JSON.parse(await readAllowed('indexed-structures/fixtures.json')).find(item=>item.id==='radix-branch-split');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');const results=[];
for(let repeat=1;repeat<=1;repeat++){const nativeLogs=[],currentLogs=[];let body=source.slice('export default '.length).trim();if(body.endsWith(';'))body=body.slice(0,-1);const native=vm.runInNewContext('('+body+')(fixture)',{fixture:structuredClone(fixture),console:{log:(...args)=>nativeLogs.push(args),error:(...args)=>nativeLogs.push(args)}},{timeout:1000});let current;try{const output=await run(source,{entryPointArgs:[structuredClone(fixture)],sink:{log:(...args)=>currentLogs.push(args),error:(...args)=>currentLogs.push(args)},budget:new Budget({maxSteps:150000,maxCallDepth:64,arrayLength:4096,stringLength:32768,dataSize:8388608,deadline:Date.now()+15000})});current=output.ok?{ok:true,steps:output.stats.nodeVisits,value:output.returnValue}:{ok:false,error:describe(output.error)};}catch(error){current={error:describe(error)};}results.push({repeat,sourceSha256:digest(source),native:{ok:native.ok,semantic:native.semantic.length,structures:native.structures.length,trace:native.trace.length,digest:digest(native),logs:nativeLogs.length},current:current.ok?{ok:current.value.ok,steps:current.steps,semantic:current.value.semantic.length,structures:current.value.structures.length,trace:current.value.trace.length,digest:digest(current.value),logs:currentLogs.length}:current,outputMatches:current.ok&&JSON.stringify(current.value)===JSON.stringify(native),logsMatch:JSON.stringify(currentLogs)===JSON.stringify(nativeLogs),lastCurrentLogs:currentLogs.slice(-4)});}console.log(JSON.stringify({date:new Date().toISOString(),results},null,2));
```

## Final handoff state

- Evidence collected on **August 29, 2026 UTC**; primary bounded checks ran from 06:51 UTC onward (America/Chicago local date August 29 by these checks). Captured main remains ecfd838abd37fb061d66dc8721bc3f86067139ad.
- Final checks: the initial Prettier check found document formatting differences; formatting is applied through apply_patch, preserving verbatim inline receipts with prettier-ignore. Recheck results are included in the handoff.
- Document self-hash is supplied in the handoff message rather than embedded recursively. Independent disposition validation is pending. No implementation, release, or all-issues-complete claim.
