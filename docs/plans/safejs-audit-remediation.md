# SafeJS audit remediation ledger

## Ownership and historical handoffs

This is the master inventory/remediation ledger. Hilbert owns the shared authoring copy; the coordinator has transferred this separate publisher copy to the serial publication agent. Publisher updates never edit or recopy the shared master plan. Issue plans remain under `docs/plans`. All 47 scope/disposition rows are preserved; pending publication is not a certified release.

- User objective: “Fix all issues discovered, push fixes as you go, make sure to pull first always, and validate each issue again. Validation=subagent, fix=subagent.” The continuing exclusion of security work is unchanged.
- Work repository: `/Users/kjopek/Workspace/poe-code-safejs-fixes`, branch `main`; entry-time HEAD verified as `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`. The coordinator/setup worker reported the freshly pulled HEAD and successful pull in this clean fix clone. No pull/fetch or other Git mutation was performed by this ledger owner.
- The alternate clean main repository was chosen because pulling `/Users/kjopek/Workspace/poe-code` was blocked by unrelated dirty `package-lock.json` and `package.json` files. Per coordinator review, the first configured-rebase pull failed before fetching; the second `git -c pull.rebase=false pull --ff-only` fetched origin refs/tags, then aborted on those worktree conflicts without merging. Thus original-repository Git refs did change, but there were no original worktree file changes, stash, reset, staging, commit or push. This ledger owner only read the specifically permitted historical audit masters there.
- Latest user handoff: August 29, 2026 UTC / August 28, 2026 Chicago. Dependency setup (`npm ci` and dependency builds) is reported ready; the ledger owner did not rerun it.
- **COLL-001:** the coordinator now reports independent READY after repair: 136 focused tests, 875 broader tests, and eight original raw workflows pass. The earlier 11 checkpoint failures were repair findings, not a current release claim. Its immutable candidate remains separate, is not included in MC-003, and is conditionally approved fourth, only after MC-003, MC-001, and STR-03 actual successful releases.
- **MC-003:** Turing's author lane and Socrates's independent validation are complete/closed, verdict READY with no reported blockers. Independent results: 4 native-first configurations, 8 original SafeJS graph runs, 56 independent plus 23 author tests (79 total), 174 broader tests, and a memory-only removal control with 29 failures. Standard numeric constants are independently validated; publisher gates and actual publication remain pending. MC-002 namespace identity remains separate and unresolved.
- **Other lanes and serial queue:** MC-001 has independent READY validation and conditional next-issue approval, only after MC-003's actual successful publication and all applicable checks. STR-03 is conditionally approved after both releases, using only Parfit's immutable five-file capture; never read the subsequently released live shared string file. Its 161 focused / 238 broader checks and 30 scoped workflow fields plus two reductions pass, but the whole original workflow still fails STR-01 metadata offsets. The coordinator now reports TREE-01 independently READY after repair (59 tests, 318 parse / 114 runtime); its separate immutable seven-file candidate is conditionally approved fifth, after COLL-001 actual successful release. None of these issues' code or releases is included or claimed by MC-003.
- **Parallelism override:** the latest user explicitly authorizes aggressive parallel fix/validation work when write ownership is disjoint, overriding the resolver skill’s one-issue-at-a-time restriction. Git integration and actual publication remain SERIAL. The user confirms MC-003 spawned as Turing (`01a04b93-e414-7861-93b6-bafa0a658c46`), STR-03 as Euclid (`01a04b94-16cb-75c3-a199-db1c49ab3426`), and TREE-01 as James (`01a04b94-59fe-7a73-869b-13d6124b9ee8`). Exact ownership is recorded in the lane table; James’s parser/lexer path claim is pending.
- **First serial publication:** MC-003 ONLY is approved, conditional on clean-publisher gates. The publisher at `/Users/kjopek/Workspace/poe-code-safejs-publish` pulled `main` successfully at `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`. Five validated files were applied with `apply_patch` after preimage checks and exact hash verification; this publisher-owned ledger is the sixth approved file. An atomic local intake receipt records `sourceIntakeComplete: true`, allowing coordinator-directed reuse of the shared object-array file. No shared files, index, or history are changed or reread after intake. Commit, push, and actual publication are pending; no release is claimed prematurely.
- **Historical publication gate failure (resolved invocation):** clean-publisher MC-003 checks pass (79 focused, 174 broader, 3,970 SafeJS tests; full build, typechecks, lint, scoped format, package lint, registry signatures). The whole-repository unit run reports five failures in `packages/toolcraft-design/src/prompts/interactive/lifecycle.test.ts:122`: Ctrl+D at the end of a nonempty readline buffer incorrectly settles with `Symbol(poe.cancel)` for text/password/select/confirm/multiselect. An isolated unchanged recheck independently reproduces 5 failed / 66 passed. This is outside the approved MC-003 file manifest; no unrelated repair or bypass is authorized. Nothing is staged, committed, pushed, or published. The entire MC-001/STR-03 queue is held pending coordinator resolution of this gate.
- Coordinator/setup-worker-reported publication baseline: npm `poe-code@latest` is `11.0.0`; the baseline Release run skipped publication. This is coordinator/setup handoff information, not a user-supplied registry observation or a registry lookup by the ledger owner. Green checks alone are insufficient: verify an actual publish and the registry version containing the fix before closing a release gate.

- **Current-base diagnosis update:** the publisher safely fast-forwarded to external origin commit `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b` after verifying no incoming/owned-path collisions. All five captured MC-003 hashes and affected preimages remain intact; only the source-independent build/packaging baseline changed. The local Ctrl+D failures are traced to inherited `TERM=dumb` selecting Node's unconditional-close readline handler. On the refreshed base, the unchanged lifecycle file still fails 5/71 with that variable and passes 71/71 when only TERM is removed. No platform or source was changed. Full candidate gates must be rerun on this new base before resumption; isolated success is not release certification. External upstream Release run `33232576840` passed its actual Ubuntu/Node v22.23.2 suite and published npm `11.0.1` at bc85287c; that is NOT this lane's work or an MC-003 release. This lane still has zero commits/pushes/publications, and the entire queue remains paused.

- **Resumption authorization:** the coordinator accepts the diagnosed TERM-dependent invocation mismatch and authorizes existing full validation and unchanged hooks under `env -u TERM`, without source/test fixes or skips. The SERIAL approved order is MC-003, MC-001, immutable STR-03, immutable COLL-001, immutable TREE-01, immutable HI-002; each issue requires its own successful local gates, one commit, pull-before-push, all applicable SHA-scoped CI checks, and actual npm publication before the next issue starts. The earlier pause/holds above describe prior handoffs, not current authorization. Current-base full gates now pass under `env -u TERM`: build, 79 focused, 174 broader, 3,970 SafeJS tests (39 existing skips), and 21,355 whole-repository tests (41 existing skips; 932 passed files / three skipped). Package/root typechecks, root ESLint, scoped formatting, all 17 package-lint rules, 479 registry signatures, and 100 attestations pass. No test/source patches or additional skips were introduced for TERM. Commit, push, and actual remediation publication remain pending. HI-002's author archive-read deviation remains documented; its independent validator reports zero excluded reads, completed screenshot-wrapper validation, 68 focused / 261 adjacent checks, full build/screenshots, corrected original 214–226 positions, and preserved legacy replay. No other issue is approved and all 47 scope rows remain in scope.

## Actual publication and next intake

MC-003 published successfully on August 29, 2026 UTC as `poe-code@11.0.2`, commit `a962264d3ec5f40c91f4e1a1bc15f3148fff3091`. Release run `33233885143` and Pages run `33233885191` both succeeded. The GitHub tag `v11.0.2` and npm `gitHead` both equal that commit; npm latest was 11.0.2 at verification. All full local gates passed with `env -u TERM`, and the unchanged commit/push hooks passed. A docs-only upstream advance to `c51139ec` was preserved by a notified non-destructive rebase; candidate hashes remained exact. The atomic publisher receipt is `out/safejs-remediation/releases/mc-003/result.json`. External 11.0.1 is not credited to MC-003.

MC-001 published as `poe-code@11.0.3`, commit `b7dfa47180e8e160bd40ca675b35073b9f422e5e`. Release `33234682813` and Pages `33234682734` both succeeded; tag `v11.0.3` and npm gitHead match that commit, and latest was 11.0.3 at verification. Local gates passed: 36 focused, 573 broader, 4,006 SafeJS and 21,391 whole-repository tests, with 39/41 existing skips respectively; full build, typechecks, lint, scoped formatting, package rules, signatures and unchanged hooks passed. The frozen-live-file intake exception was explicitly authorized for MC-001 only. Its completed atomic receipt is `out/safejs-remediation/releases/mc-001/result.json`.

STR-03 published as `poe-code@11.0.4`, commit `33c73a21fb01875b0e2297ccac955974a0889991`. Release `33235331960` and Pages `33235331885` both succeeded; tag `v11.0.4` and npm gitHead match the commit, and latest was 11.0.4 at verification. Local gates passed: 161 focused, 238 broader, 4,167 SafeJS and 21,552 whole-repository tests (39/41 existing skips), full build, typechecks, lint, scoped formatting, package rules, signatures and unchanged hooks. STR-01 metadata offsets and the separate regex own-key-order observation remain unresolved. Completed receipt: `out/safejs-remediation/releases/str-03/result.json`.

COLL-001 is the current candidate. Its six-file immutable manifest hash and all captured payload hashes match; both production preimages match the original base, preserving all prior published issues. No live shared files were read. Current publisher gates pass: 136 focused, 875 broader, 4,303 SafeJS and 21,688 whole-repository tests (39/41 existing skips), full build, package/root typechecks, root ESLint, scoped formatting, all package rules, 479 registry signatures and 100 attestations under `env -u TERM`. Actual COLL-001 commit/push/publication remain pending; TREE-01 and HI-002 follow only after the preceding actual successful release.

## Pending validation observations

These coordinator-reported functional observations supplement, rather than replace or close, the original 47 scope rows. They are not security findings and are not dismissed as baseline bugs or unsupported behavior.

- **Custom array properties across checkpoints:** expected keys `[0,metadata,raw]` and preserved shared aliases become `[0]`; reported locus `snapshot/serialize.ts:444`. Evidence: `/Users/kjopek/Workspace/poe-code-safejs-array-metadata/out/safejs-remediation/array-own-metadata-validation/checkpoint-metadata-control.json`, validation plan line 98. Pending checkpoint contract/fix and independent validation. ARRAYOWN's earlier five argument-evaluation-order blockers are now repaired: coordinator reports scoped READY with 26 plus 15 tests, 710 broader / nine filtered checks, and ten originals (eight full matches, two qualified). Its nine-publishable-file immutable manifest is `/Users/kjopek/Workspace/poe-code-safejs-array-metadata/out/safejs-remediation/array-own-metadata-validation/revalidation-call-order/candidate-051cfa0474bd5d62/manifest.json`, SHA-256 `051cfa0474bd5d627bf1589b0b4fada3295782a3e653d76199992055361837ae`. This does not close checkpoint metadata or regex key-order observations. ARRAYOWN is not publication-approved; four preimages overlap later integration and require three-way preservation of COLL/interpreter changes plus independent merged validation. The capture also distinguishes 28 historical and 32 evidence files; none is a blanket staging authorization.
- **Regex match metadata key order:** nine own-key-order differences in the same array-validation full-original outputs remain pending regex-lane contract/fix. This is separate from STR-03; its publication must not claim these differences resolved.
- **Async computed object methods:** async computed shorthand is rejected while async named and computed synchronous methods work. The NUM001 validation plan in the function-arity clone records this observation; pending IP002 parser-companion triage, not an unsupported-behavior closure.
- **Enumerable host-object getters:** newly reported low-level getter differences remain an explicit functional observation pending triage. Details are in ARRAYOWN capture evidence/REVALIDATION.md; this is not broadened into security scope or silently dismissed.
- **Future integration, not publication authorization:** NUM001 is independently READY with immutable manifest `/Users/kjopek/Workspace/poe-code-safejs-function-arity/out/safejs-remediation/num-001-validation/candidate/manifest.json` (SHA-256 `ab188c65b988fbc10a93802350ef6c2a33c980d9d7855ed9f8571c9560c7e6b1`). OBJ001 is independently READY with immutable manifest `/Users/kjopek/Workspace/poe-code-safejs-object-aliases/out/safejs-remediation/obj-001-validation/candidate/manifest.json` (SHA-256 `ba278a0ffeddb5cb0c22485d56286433affa3046be69c8df8f8598681424a2da`). Neither is approved for publication. Their bc852-based patches overlap COLL interpreter and MC-003 globals respectively; future integration requires three-way preservation of published fixes and fresh independent merged validation, never full-file overwrite.
- **Read-policy qualification:** Noether clarified that “all archive bytes” meant the 13 permitted functional audit inputs, with zero excluded reads. HI-002's already-disclosed incidental author archive read remains qualified; the validator reported zero excluded reads. This publisher does not reread those payloads to record coordinator observations.
- **Post-HI integration-only scheduling:** only after all six approved releases succeed, the coordinator authorizes OBJ001 three-way integration, not staging/commit/push. Preserve MC-003 constants and upstream changes against base preimage SHA-256 `978b109161fe4a644a12362788fb2dc21a3ab938e10d59c1c435809fd5ca9726`; never overwrite with candidate whole-file SHA-256 `45fc863ad3baec58b5d24a894b35249a997fbf5e256b3c1450a6c32d4d1b09b4`. Freeze the exact merged source/tests/plans and hashes, then notify the coordinator for a separate independent validator. NUM001/AW/CBI/ARRAY, STR04/PPR002, and AR001 have no publication approval; PPR002 jobs-v6-to-v7 blanket compatibility remains under scrutiny.

## Additional coordinator validation handoffs

These observations do not expand the six-issue publication approval or remove any of the original 47 rows.

- **CBI001 standalone READY only:** the independent validator resolved repository-environment failures without author production/test changes. Reported gates: 67/67 build tasks, previous nine failure targets 225/225, configured root type diagnostics 181 to zero, repository 17,383 passed / two skipped with unchanged safety exclusions, SafeJS 729. Earlier failures remain preserved. The superseding immutable manifest is `/Users/kjopek/Workspace/poe-code-safejs-callback-delivery/out/safejs-remediation/cbi-001-validation/post-build/candidate/manifest.json`, SHA-256 `bb00ab9add6a9f5d8340942d4e70e43e3a57bb2b218059a1035bbc196c8a3768`. Fresh merged-core independent validation remains required; no publication approval.
- **STR04 not READY:** cursor assertions and original workflow pass, but 118 full-result assertions fail because guest `match.index` is undefined. These red results are retained as the existing ARRAYOWN/STR01 dependency, not a request to duplicate the separately implemented metadata fix. Godel's report is `/Users/kjopek/Workspace/poe-code-safejs-regex-cursor/docs/plans/safejs-validate-str-04.md`; evidence manifest `out/safejs-remediation/str-04-validation/manifest.json` has SHA-256 `fd5a5e8271afcb96478af1204c20c794371c2b3f550cea8327f7477f0bf5b117`. After approved HI002, integrate OBJ001 first; prioritize independently revalidated merged ARRAYOWN before STR04. Each merged candidate requires a fresh independent validator before any commit authorization. STR04 has no publication approval.
- **PPR002 independently REJECTED:** eight fresh v7 restores pass, but six genuinely working v6 snapshots regress to rejection (25 passed / six failed independent checks). Four original raw v6 failures were reproduced separately. Working-control traces are identical for v6/v7, so blanket incompatibility is not justified by the evidence. Returned to the author for backward-compatibility repair; no major-version or publication approval. Report: `public-promise-recovery/docs/plans/safejs-ppr-002-independent-validation.md:60`. Keep the failed controls and pending disposition explicit.

- **STR02 standalone scoped READY, not publication-approved:** independent unchanged-original-source and built-core results match native; 189 independent / 334 broader checks, 67 build tasks, types/lint/format pass. Five-file immutable manifest: `/Users/kjopek/Workspace/poe-code-safejs-string-no-match/out/safejs-remediation/str-02-validation/manifest.json`, SHA-256 `91870e73fb885bef3067544ca238d6d915730cdbce56df374040baca7c54f45c`. The b7dfa471 base predates STR-03; later integration must three-way preserve published replacement changes and receive fresh independent merged validation. No blanket string parity: metadata and STR03/04/05 qualifications remain distinct. Existing release and OBJ/ARRAY integration order is unchanged.

## Authority, paths, and exclusions

`A/` below means the historical, uncommitted sibling audit at `/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27/`. Links are relative from this plan to that sibling checkout. They are provenance references, not a requirement to copy audit payloads into Git. Repository-relative source/doc references refer to the clean main checkout unless explicitly labeled historical.

- Authoritative master report: [`A/REPORT.md`](../../../poe-code/out/safejs-audit-2026-08-27/REPORT.md).
- Case and evidence metadata: [`A/inventory.json`](../../../poe-code/out/safejs-audit-2026-08-27/inventory.json); use `/currentPriorityOrderingV12`, `/currentContractMappingV12`, `/currentContractAssessmentUpdates`, `/cases`, `/familyFindingAliases`, `/candidateResolutions`, and `/reviewOnlyOutcomes`, not superseded historical ranks or classifications.
- Full retained case ledger: [`A/SNIPPETS.md`](../../../poe-code/out/safejs-audit-2026-08-27/SNIPPETS.md). Verification/bootstrap: [`A/inventory-verification.json`](../../../poe-code/out/safejs-audit-2026-08-27/inventory-verification.json).
- Audit baseline is `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`; fixed runtime-cohort cutoff is `2026-08-28T00:27:06Z`. Audit evidence is not current-main reproduction, a current fix, or current independent validation. Historical V12 handoff did not itself certify later completion; no overall-goal completion is claimed here.
- Before reading any nonbootstrap audit payload, the exact **38 excluded paths** were loaded from `inventory-verification.json#/archiveReadPolicy/excludedPaths` and checked for 38 unique entries. The entire `A/security/` directory is additionally excluded, including any paths not in that list. No excluded bytes were read, hashed, displayed, parsed, or executed. Future workers must bootstrap that same exact list before payload reads; do not infer exclusions from filenames.
- `A/dynamic-deflate-provenance-review/` remains outside the adopted cohort and blocked. No recursive `out` search/read or archive probe is authorized. Security probes and unsolicited coverage expansion remain out of scope; the user explicitly authorizes new functional remediation reproductions and independent issue-validation runs. Closure of the old audit campaign does not prohibit those runs. This ledger-only worker still performs no runtime work. Archived IDs/hashes/census remain inherited metadata only.

Observed master hashes (metadata integrity only, not a new audit certification):

| Master | SHA-256 |
| --- | --- |
| `A/REPORT.md` | `40d467e72bd741dfeaa5c6b776c3d2cc7dc61d622e0e08419c05506c2c428fb1` |
| `A/inventory.json` | `00ca8535d28a90d9bc0810090db149a91491a6ed1048d8e55c75fa7d3f78a822` |
| `A/SNIPPETS.md` | `b4b9808508100bbe836792e11e9e2d8ee7fc4ace10b6650ae6ee5704e8b5fb41` |
| `A/inventory-verification.json` | `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827` |

## Complete scope census

| Scope | Count | Meaning |
| --- | ---: | --- |
| Ranked priority groups | 21 | 7 P1, 13 P2, 1 P3; 23 finding IDs, not 21 proven implementation causes |
| Ranked confirmed failure/incompatibility IDs | 22 | 20 groups; retain derived-contract defects as actionable |
| Ranked representation/compatibility observation | 1 | MC-002 stays in scope pending decision; absence of a singleton promise is not ratification or wont-fix |
| Ranked contract categories | 21 | 13 express, 7 derived, 1 compatibility-only; confidence is separate from impact and independent confirmation |
| Additional named unranked candidates | 2 | PPR-001 and IP-002; neither silently omitted nor automatically assigned a new severity |
| Historical documentation-drift rows | 3 | HI-001, AR-002, AR-003; current reconciliation is separate from historical observations |
| Other explicit disposition rows | 21 | O01–O21 include documentation gaps, unresolved observations, corrected expectations, nonbugs and coverage limits |
| Total master scope/disposition rows | 47 | 21 ranked + 2 candidates + 3 historical + 21 other; NOT 47 confirmed bugs |
| Active-functional audit cases | 628 | 412 PASS, 128 FAIL, 27 expected-rejection, 44 unsupported, 17 unresolved |
| All historical corpus rows | 663 | Includes 35 archived rows accounted for by metadata only; archives excluded from this work |
| Review-only configurations | 30 | 93 children; 11 PASS, 11 FAIL, 1 MIXED, 4 expected-rejection, 3 unsupported; not additional corpus cases |

Every one of the 128 functional FAIL and 17 unresolved case rows is associated below with a ranked issue or explicit unranked disposition. All 30 review-only rows are mapped separately. A passing rewrite does not erase an original failure; a FAIL label does not alone prove a product contract defect. Unknowns remain pending investigation, not silently closed or converted into scope exclusions.

## Parallel lanes and serial integration

Only the coordinator assigns write ownership and launches/reassigns subagents. Fix and independent-validation agents must be different. Workers may read needed current contracts but cannot edit another lane’s files, the master ledger, shared lockfiles, generated output, or global configuration without explicit ownership transfer. Validation freezes the complete issue diff, not merely its main source file. A discovered need to touch a frozen/owned file pauses that lane for coordinator reassignment; it does not authorize an overlap.

| Lane | Issue / owner | Exclusive write ownership or freeze | Next gate |
| --- | --- | --- | --- |
| A | COLL-001; coordinator reports repaired and independently READY | Separate immutable six-file candidate; no changes in MC-003 publication | Conditionally fourth after MC-003, MC-001, and STR-03 actual releases |
| B | MC-003; Turing and Socrates complete/closed | Five approved postimages captured in publisher; shared source intake complete | First publication approved subject to clean local gates and actual release |
| C | STR-03; Euclid author / Parfit independent READY receipt | Immutable captured five files only; live shared string file released to another owner | Conditionally third after MC-003 and MC-001 releases; STR-01 remains unfixed |
| D | CONTEXTUAL-FROM / TREE-01; coordinator reports repaired and independently READY | Separate immutable seven-file candidate; no changes in MC-003 publication | Conditionally fifth after COLL-001 actual release |
| Ledger | Hilbert shared copy; serial publisher owns this copy | Separate checkout copies of `docs/plans/safejs-audit-remediation.md`; preserve all 47 rows | Publisher ledger accompanies MC-003; shared ledger untouched |
| Integration | Serial publisher; coordinator controls approval | `/Users/kjopek/Workspace/poe-code-safejs-publish`; exact approved paths only; no shared staging/commits | MC-003 first; MC-001 queued only after actual MC-003 release and all applicable checks |

Recommended remaining disjoint ownership groups are scheduling suggestions, not newly assigned work or assertions about a proven root cause:

| Candidate lane/group | Likely write island | Collision/ordering rule |
| --- | --- | --- |
| MC-001 lint global recognition | `packages/safejs/src/lint/` and issue-specific lint tests | Independent of the current interpreter/object-array/string islands; first reproduce because current docs/lint may have changed |
| IP-002 remaining parser work | Parser implementation plus parser tests | TREE-01 is already assigned to James, with exact parser/lexer path claim pending; wait for his ownership claim/release before assigning overlap, and do not assume a shared root cause |
| HI-002 Markdown diagnostic offsets | Markdown loader/span mapping and dedicated tests | Can run alongside the above after reserving exact paths; avoid shared harness/SDK tests owned by another lane |
| OBJ-001 and OBJ-003 | `interp/globals/object-array.ts` and object/iterable tests | Wait for MC-003 freeze/integration or transfer the file; do not parallelize edits to the same file |
| STR-02, STR-04, STR-05 | `interp/methods/string.ts`, possibly regex helper paths | Wait for STR-03 file release; serialize distinct issues or reserve proven separate helper files explicitly |
| ARRAY-OWN-METADATA, NUM-001, LANG-01, CTX-001 | Interpreter/property/callback dispatch and their dedicated tests | Do not launch writes touching COLL-001 frozen interpreter files; inspect exact write sets before splitting; CTX and LANG remain separate defects |
| SOURCE-EXCEPTION-COERCION | Interpreter/value/error propagation | Potential interpreter and Promise overlap; reserve exact files after Galileo releases the freeze |
| AR-001, PPR-002, CBI-001, PPR-001, O13/O14 | Snapshot, Promise, callback/replay implementation | Treat as one conflict domain until exact write sets demonstrate nonoverlap; no semantic merging merely to gain concurrency |
| OBJ-002 sparse clone/checkpoint | Serialization/graph traversal and clone dispatch | Reserve actual files; may collide with object-array and replay lanes |
| MC-002 namespace identity | Module import/namespace caching | Contract decision and current reproduction first; reserve import/interpreter paths before writing |
| Historical/documentation qualifications | Dedicated non-README docs and SKILL_ templates if needed | Disjoint work only after exact ownership; README changes need user permission, templates must sync through the designated command |

### Required gates

1. Coordinator records a successful pull of main before starting a fix lane. Shared-worktree Git operations are serialized; do not pull while another agent is mutating files. Pause/freeze writers for safe integration, never stash/reset/revert another worker’s or the original repository’s changes, and never create a branch. If integrating a pull changes validated code, its old validation receipt is stale and must be renewed.
2. Fix subagent reproduces the original failing case on the pulled revision, distinguishes audit-era evidence from current results, and records its exact command, revision, expected/actual result, and original source path in its own issue plan. Code fixes require a focused failing test before the minimal implementation; use memfs for filesystem tests and mock LLM/slow dependencies. This ledger task does not run that campaign.
3. Separate validation subagent checks the frozen diff and reruns the original failure plus relevant controls, not just a rewritten compatible example or author test. Record the validated revision/diff, commands, outcomes and limits. Screenshots are required for CLI-visible effects; workflow changes use `npm run lint:workflows`, not workflow unit tests. New overlap or concurrent changes invalidate affected receipts.
4. After explicit approval, perform one serial publication transaction: pull first in the publisher, verify affected preimages, apply exact validated postimages using `apply_patch`, verify hashes and issue-only scope, and run full clean-publisher gates. Stage only approved files and plans; Conventional Commit, no co-author or `--no-verify`. Pull again before pushing main; changed incoming code needs independent revalidation, and a diverged candidate requires coordinator notice before any non-destructive rebase. Never reset, force-push, or stage/commit the shared fix checkout. MC-003 is first, with this ledger as its sixth approved file; conditional MC-001 queue approval does not batch the issues. Never include fonts, audit/output artifacts, or another lane's unfinished code.
5. Keep that serial publication lane occupied while monitoring required checks AND the actual GitHub release/publish step for the pushed SHA. Record workflow/run identity, publish result, released version/tag and registry evidence that `poe-code@latest` contains the issue commit. The supplied `11.0.0` baseline and a green Release job with publication skipped do not meet this gate. Publication is on GitHub only; no local publish. See `docs/development/NPM_PUBLISHING.md`.
6. Only after actual publication succeeds mark an actionable issue released/closed. If there is no code defect on current main, independent evidence must establish that disposition; do not manufacture a fix or call it fixed by this effort. Historical closed/nonbug rows can become verified non-actionable with explicit reasons and applicable gates marked N/A only after disposition review. Other disjoint implementation/validation lanes may continue while publication is monitored, but no second commit/pull/push/release transaction overlaps.

Gate legend: R = current reproduction receipt; I = implementation receipt; V = independent validation; C = commit; P = push; L = actual release/publication. `pending` means not established here. `reported done` is not independent acceptance. No README permission question blocks this inventory; request permission only if a future fix actually requires a README edit and no authorized alternative meets the need.

## Ranked queue — all 21 groups / 23 IDs

| Rank | Impact | Group / IDs | Contract category and confidence | Assignment | R | I | V | C | P | L |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | P1 | `COLL-001` / `COLL-001` | derived; moderate-strong | Repaired; conditional fourth issue | reported validated | reported repaired | READY: 136 focused / 875 broader | pending | pending | pending |
| 2 | P1 | `ARRAY-OWN-METADATA` / `STR-01`, `NUM-002` | derived; strong internal consistency; ordinary own-field read is derived | Pending | pending | pending | pending | pending | pending | pending |
| 3 | P1 | `OBJ-001` / `OBJ-001` | express; strong named-method coverage | Pending | pending | pending | pending | pending | pending | pending |
| 4 | P1 | `SOURCE-EXCEPTION-COERCION` / `AW-001`, `AW-002` | derived; moderate for cross-function/await identity; high observed source-only inconsistency | Pending | pending | pending | pending | pending | pending | pending |
| 5 | P1 | `MC-003` / `MC-003` | express; strong affirmative standard-constant coverage | Turing/Socrates complete; publisher release verified | independently validated | implemented | READY: 79 focused / 174 broader | a962264d | main pushed | 11.0.2; Release 33233885143 / Pages 33233885191 |
| 6 | P1 | `RETAINED-CALLBACK-DELIVERY` / `CBI-001` | derived; explicit hook/history/lexical retention; moderate-weak completed-registration lifetime implication | Pending | pending | pending | pending | pending | pending | pending |
| 7 | P1 | `NUM-001` / `NUM-001` | derived; limited/implicit source-function arity expectation | Pending | pending | pending | pending | pending | pending | pending |
| 8 | P2 | `OBJ-002` / `OBJ-002` | express; strong named clone/array support; sparse-checkpoint reach is derived | Pending | pending | pending | pending | pending | pending | pending |
| 9 | P2 | `AR-001` / `AR-001` | express; strong explicit in-flight dump API | Pending | pending | pending | pending | pending | pending | pending |
| 10 | P2 | `PPR-002` / `PPR-002` | express; strong | Pending | pending | pending | pending | pending | pending | pending |
| 11 | P2 | `STR-03` / `STR-03` | express; strong named regex-aware method semantics within subset | Euclid/Parfit READY; release verified | reported validated | implemented | READY for scoped STR-03; STR-01 remains | 33c73a21 | main pushed | 11.0.4; Release 33235331960 / Pages 33235331885 |
| 12 | P2 | `STR-04` / `STR-04` | express; strong named regex-aware method coverage | Pending | pending | pending | pending | pending | pending | pending |
| 13 | P2 | `LANG-01` / `LANG-01` | express; moderate-strong ordinary method composition | Pending | pending | pending | pending | pending | pending | pending |
| 14 | P2 | `CONTEXTUAL-FROM` / `TREE-01` | derived; moderate ordinary grammar inference | Repaired; conditional fifth issue | reported validated | reported repaired | READY: 59 focused / 318 parse / 114 runtime | pending | pending | pending |
| 15 | P2 | `OBJ-003` / `OBJ-003` | express; strong named fromEntries plus supported iterable types | Pending | pending | pending | pending | pending | pending | pending |
| 16 | P2 | `MC-001` / `MC-001` | express; strong exact global plus lint-name guarantee | Mencius/Hilbert READY; release verified | reported validated | implemented | READY: 36 focused / 573 broader | b7dfa471 | main pushed | 11.0.3; Release 33234682813 / Pages 33234682734 |
| 17 | P2 | `STR-02` / `STR-02` | express; strong explicit match method coverage | Pending | pending | pending | pending | pending | pending | pending |
| 18 | P2 | `STR-05` / `STR-05` | express; strong explicit split method coverage | Pending | pending | pending | pending | pending | pending | pending |
| 19 | P2 | `HI-002` / `HI-002` | derived; moderate SDK absolute-prefix inference; explicit original-line guarantee passes | Independent READY; conditional sixth issue; author archive-read qualification retained | reported validated | reported implemented | READY: 68 focused / 261 adjacent; screenshots | pending | pending | pending |
| 20 | P2 | `CTX-001` / `CTX-001` | express; strong-broad-qualified | Pending | pending | pending | pending | pending | pending | pending |
| 21 | P3 | `MC-002` / `MC-002` | compatibility-only; high observed difference; namespace singleton guarantee unestablished | Pending | pending | pending | pending | pending | pending | pending |

### Baseline evidence by ranked group

All expected/actual outcomes below are retained AUDIT BASELINE evidence, not results produced by this ledger or evidence that current main still fails. Historical contract line numbers may have moved. Each group’s current gates remain those in the queue; original controls and related manifestations must survive later validation.

#### 1. COLL-001 — P1

- **COLL-001 — Direct Map/Set iteration silently omits or retains work.** Expected: Seven vertices processed and reachable; complete emit path Actual: Only start processed; three reachable; empty path
- **Original associated case IDs (including retained controls):** `collections:07-map-worklist-reachability`, `collections:08-set-worklist-reachability`, `collections:10-map-growth-reduction`, `collections:11-set-growth-reduction`, `collections:12-map-update-delete-reduction`, `collections:13-set-delete-reduction`.
- **Original entry paths:** `A/collections/07-map-worklist-reachability.ajs`; `A/collections/08-set-worklist-reachability.ajs`; `A/collections/10-map-growth-reduction.ajs`; `A/collections/11-set-growth-reduction.ajs`; `A/collections/12-map-update-delete-reduction.ajs`; `A/collections/13-set-delete-reduction.ajs`.
- **Reproduction/evidence pointers:** `A/collections/10-map-growth-reduction.ajs`; `A/set-iteration-review/results.json`; `A/functional-review/results.json#/records/0`; `A/functional-review/results.json#/records/1`.
- **Spec confidence:** derived — moderate-strong. Only selected direct Set/Map membership cases; eager methods intentionally return arrays; no new Set-return or source-object alias assertion.

#### 2. ARRAY-OWN-METADATA — P1

- **STR-01 — Regex metadata loss truncates scans and prevents progress.** Expected: Match index 2 and original input; scanner consumes 67 code units Actual: Metadata reads undefined; scanner consumes 3; semver repeats match then exhausts ordinary step allowance
- **NUM-002 — Script-created array metadata writes succeed and enumerate, but reads return undefined.** Expected: Own array x0/x1 reads return 2.5 and 7.5; 13 histogram bins retain numerical bounds Actual: Own-property and key enumeration succeed but reads yield undefined; bin memberships match and bounds disappear; record-bin control passes
- **Original associated case IDs (including retained controls):** `strings:04-semver-coerce-sort`, `strings:06-template-replacement-unicode`, `strings:07-mustache-scanner-offset`, `strings:r01-match-metadata`, `strings:r02-semver-overlap-progress`, `numerics:09-histogram-object-configuration`, `numerics:13-array-metadata-reduction`, `data-pipelines:lcs-records`, `data-pipelines:lcs-duplicates`.
- **Original entry paths:** `A/strings/examples/04-semver-coerce-sort.safejs`; `A/strings/examples/06-template-replacement-unicode.safejs`; `A/strings/examples/07-mustache-scanner-offset.safejs`; `A/strings/reductions/r01-match-metadata.safejs`; `A/strings/reductions/r02-semver-overlap-progress.safejs`; `A/numerics/09-histogram-object-configuration.ajs`; `A/numerics/13-array-metadata-reduction.ajs`; `A/data-pipelines/lcs-array-diff.ajs`.
- **Reproduction/evidence pointers:** `A/strings/reductions/r01-match-metadata.safejs`; `A/numerics/REPORT.md`; `A/numerics-review/results.json`; `A/data-pipelines-review/results.json#/findings/1`.
- **Spec confidence:** derived — strong internal consistency; ordinary own-field read is derived. One shared group for STR-01/NUM-002 and existing LCS consequence; do not add a method-dispatch ID. The host round-trip test is supporting evidence, not the normative in-script read promise.
- **Aliases/related manifestations:** `DP-2`; keep original family labels and evidence, without inflating cause counts.

#### 3. OBJ-001 — P1

- **OBJ-001 — Object transforms detach nested reference values.** Expected: {same:true,sourceCount:2,resultCount:2} Actual: {same:false,sourceCount:1,resultCount:2}
- **Original associated case IDs (including retained controls):** `objects:pick-transform`, `objects:pick-transform-mutate`, `objects:identity-entries`, `objects:identity-values`, `objects:identity-from-entries`.
- **Original entry paths:** `A/objects/lodash-pick-transform.ajs`; `A/objects/reductions/object-identity.ajs`.
- **Reproduction/evidence pointers:** `A/objects/reductions/object-identity.ajs`; `A/from-entries-alias-review/results.json`; `A/from-entries-alias-review/REVIEW.md`.
- **Spec confidence:** express — strong named-method coverage. The compound rebuiltIdentity failure does not isolate Object.fromEntries alias behavior independently of already-detached entries. No host round-trip identity is promised here.

#### 4. SOURCE-EXCEPTION-COERCION — P1

- **AW-001 — Source error-shaped rejection records lose application metadata.** Expected: Plain source error record keeps code RETRY, retryable true, context.job alpha and identity Actual: code/retryable/context become undefined and identity false; allocated Error and catch-continuation controls pass
- **AW-002 — Source throws/rejections are copied across function/await propagation.** Expected: Recovery mutates original attempt to 1 and nextAttempt to 2; same reason and annotations remain true Actual: Original attempt stays 0, annotations stay empty, nextAttempt is 1, identities false
- **Original associated case IDs (including retained controls):** `async-workflows:12-finally-domain-records`, `async-workflows:13-domain-error-metadata`, `async-workflows:01-waterfall-identity`, `async-workflows:04-nested-finally-precedence`, `async-workflows:05-saga-delegation-cleanup`, `async-workflows:06-scan-reduce-state`, `async-workflows:07-forkjoin-last-values`, `async-workflows:08-plain-thenable-combinators`, `async-workflows:09-rejection-identity-matrix`, `async-workflows:10-recovery-annotation`.
- **Original entry paths:** `A/async-workflows/rewrites/12-finally-domain-records.js`; `A/async-workflows/reductions/13-domain-error-metadata.js`; `A/async-workflows/examples/01-waterfall-identity.js`; `A/async-workflows/examples/04-nested-finally-precedence.js`; `A/async-workflows/examples/05-saga-delegation-cleanup.js`; `A/async-workflows/examples/06-scan-reduce-state.js`; `A/async-workflows/examples/07-forkjoin-last-values.js`; `A/async-workflows/examples/08-plain-thenable-combinators.js`; `A/async-workflows/reductions/09-rejection-identity-matrix.js`; `A/async-workflows/reductions/10-recovery-annotation.js`.
- **Reproduction/evidence pointers:** `A/async-workflows/reductions/13-domain-error-metadata.js`; `A/async-workflows/reductions/10-recovery-annotation.js`; `A/async-value-review/results.json`.
- **Spec confidence:** derived — moderate for cross-function/await identity; high observed source-only inconsistency. Plain records with name/message are not allocated Error(...) objects. Allocated Error metadata/control passes. Deliberate host conversion is separate; no actual external retry/routing loss or finally-precedence defect is established. Source tests do not upgrade the public contract to express.

#### 5. MC-003 — P1

- **MC-003 — Missing standard numeric constant silently corrupts reachable graph distances.** Expected: Alpha distances [0,6,2,8], beta [0,9,6,15], with multi-node reachable routes and finite adjusted values. Actual: Each original graph run silently returns undefined for six reachable non-source distances, NaN adjusted values and singleton routes; full Infinity rewrite restores graph payloads twice, not namespace-container equality.
- **Original associated case IDs (including retained controls):** `module-composition:graph--object-object`, `module-composition:graph--map-map`, `module-composition:graph--object-map`, `module-composition:graph--map-object`.
- **Original entry paths:** `A/module-composition/examples/graph.safejs`.
- **Reproduction/evidence pointers:** `A/module-composition-review/commands.md`; `A/module-composition-review/results.json`.
- **Spec confidence:** express — strong affirmative standard-constant coverage. Only selected object/object shape. Six reachable non-source distances are wrong per original run; full rewrite restores graph payloads but namespace boolean still differs. Not module isolation or harness execution success.

#### 6. RETAINED-CALLBACK-DELIVERY — P1

- **CBI-001 — New source-awaited delivery after replay returns a stale callback result.** Expected: After historical catch-up and a NEW awaited delivery: total4/count2/first2/second4, two source callback invocations, and nested step("second:0"). Actual: Identical-event reduction resumes ok:true with total2/count1/first2/second2, omitting the new callback/step/trace. Independent no-input control repeats twice. Substantial map and distinct events refuse rather than silently returning a wrong map value.
- **Original associated case IDs (including retained controls):** `callback-inputs:map-prefulfilled`, `callback-inputs:map-released`, `callback-inputs:scan-prefulfilled`, `callback-inputs:scan-released`, `callback-inputs:validation-prefulfilled`, `callback-inputs:validation-released`, `callback-inputs:counter-distinct`, `callback-inputs:counter-identical`.
- **Original entry paths:** `A/callback-inputs/workflows/01-retained-map.js`; `A/callback-inputs/workflows/02-retained-scan.js`; `A/callback-inputs/workflows/03-retained-validation.js`; `A/callback-inputs/reductions/01-distinct-events.js`; `A/callback-inputs/reductions/02-identical-events.js`.
- **Reproduction/evidence pointers:** `A/callback-loss-review/REPRODUCE.md`; `A/callback-loss-review/REVIEW.md`; `A/callback-loss-review/results.json`.
- **Spec confidence:** derived — explicit hook/history/lexical retention; moderate-weak completed-registration lifetime implication. Independent four silent losses/four refusals are scoped to retained completed registration. Passing declared callback joined/detached proofs are a different pending-invocation lifecycle, not a fix or disproof. No fully detached post-run guarantee.

#### 7. NUM-001 — P1

- **NUM-001 — Missing function.length silently chooses the wrong bisector algorithm.** Expected: Comparator arity 2 selects descending bisector: queries 1.5, 2, 4 yield [5,7,5], [3,5,3], [1,2,1]; reduction lengths are 2,1,1 Actual: Function lengths read undefined; descending queries all return [0,0,0]; explicit-mode control matches native
- **Original associated case IDs (including retained controls):** `numerics:08-bisector-stable-ordering`, `numerics:11-function-arity-reduction`.
- **Original entry paths:** `A/numerics/08-bisector-stable-ordering.ajs`; `A/numerics/11-function-arity-reduction.ajs`.
- **Reproduction/evidence pointers:** `A/numerics/REPORT.md`; `A/numerics-review/REVIEW.md`.
- **Spec confidence:** derived — limited/implicit source-function arity expectation. The three expected triples [5,7,5], [3,5,3], [1,2,1] become zero triples, but ordinary invocation works. Absence from limitations is not affirmative reflection coverage. Do not reclassify as comparator arithmetic or sorting failure.

#### 8. OBJ-002 — P2

- **OBJ-002 — Sparse arrays break structuredClone and automatic checkpoint serialization.** Expected: Empty two-slot clone: length 2, no keys, detached true Actual: TypeError: undefined is not iterable (cannot read property Symbol(Symbol.iterator))
- **Original associated case IDs (including retained controls):** `objects:clone-structured`, `objects:structured-empty-sparse`, `objects:structured-sparse-value`, `checkpoint-composition:codec-ascii`, `checkpoint-composition:codec-unicode`, `checkpoint-composition:reduced-sparse`.
- **Original entry paths:** `A/objects/lodash-clone.ajs`; `A/objects/reductions/structured-sparse.ajs`; `A/checkpoint-composition/03-codec-workflow.ajs`; `A/checkpoint-composition/reduced-sparse-checkpoint.ajs`.
- **Reproduction/evidence pointers:** `A/objects/reductions/structured-sparse.ajs`; `A/checkpoint-composition/results.json#/findings/0`.
- **Spec confidence:** express — strong named clone/array support; sparse-checkpoint reach is derived. Clone independently confirmed; automatic sparse checkpoint manifestation author-repeated only in reviewed records. Dense rewrite/completed snapshot success does not certify sparse intermediate resume or universal failure.
- **Aliases/related manifestations:** `CPC-01`; keep original family labels and evidence, without inflating cause counts.

#### 9. AR-001 — P2

- **AR-001 — External checkpoint calls fail during ordinary pending host calls.** Expected: Independent external dump/dumpCurrent serialize pending run; signal callback delivers snapshot Actual: reentry rejection; zero signal snapshots; ordinary result still {first:20,final:13}
- **Original associated case IDs (including retained controls):** `async-replay:10-external-dump::plain`, `async-replay:05-callback-checkpoint::callback-reissue`, `async-replay:05-callback-checkpoint::callback-external`, `async-replay:06-pending-retry-map::retry-reissue`, `async-replay:06-pending-retry-map::retry-external`, `async-replay:06-pending-retry-map::retry-external-missing`, `async-replay:07-co-live-checkpoint::co-live`.
- **Original entry paths:** `A/async-replay/reductions/10-external-dump.js`; `A/async-replay/examples/05-callback-checkpoint.js`; `A/async-replay/examples/06-pending-retry-map.js`; `A/async-replay/examples/07-co-live-checkpoint.js`.
- **Reproduction/evidence pointers:** `A/async-replay/reductions/10-external-dump.js`; `A/functional-review/results.json`; `A/async-replay/results.json#/externalDumpTimedRuns/0`.
- **Spec confidence:** express — strong explicit in-flight dump API. Completed dump and replay pass with zero new host calls. No universal snapshot failure, signal-handler confirmation, lost-progress incident, or all-resume portability conclusion.

#### 10. PPR-002 — P2

- **PPR-002 — Completed public native-Promise inputs cannot be restored without the original promise.** Expected: Restore the completed input without the original Promise; the single control returns {value:7,sameHandle:true}. Actual: Six author and four independent completed restores reject with TypeError: Promise replay references work not created at this position. Independent single nonaliased control rejects before the boundary at two steps with no calls.
- **Original associated case IDs (including retained controls):** `public-promise-recovery:full-completed-after-left`, `public-promise-recovery:full-completed-both-pending`, `public-promise-recovery:single-completed-restore`.
- **Original entry paths:** `A/public-promise-recovery/01-public-input-scan.ajs`; `A/public-promise-recovery/03-single-public-input-recovery.ajs`.
- **Reproduction/evidence pointers:** `A/public-promise-review/REPRODUCE.md`; `A/public-promise-review/results.json#/rows/8`; `A/public-promise-review/contract-gates.json`; `A/public-promise-review/fresh-single-snapshot.json`.
- **Spec confidence:** express — strong. No internal factory fallback; genuine public index/run and raw native Promises. Initial callable boundary paths rebound; source and recorded snapshots validated. Nonaliased single control separates this defect from PPR-001. Pending watchdogs are not attributed to this cause.

#### 11. STR-03 — P2

- **STR-03 — Regex replacement captures and context produce wrong strings.** Expected: Missing optional capture <>; $10 becomes <a0>; regex prefix/suffix yield aac/acc Actual: <$1>, <$10>, and literal context markers respectively
- **Original associated case IDs (including retained controls):** `strings:06-template-replacement-unicode`, `strings:r03-replacement-captures`, `strings:r04-replacement-context`.
- **Original entry paths:** `A/strings/examples/06-template-replacement-unicode.safejs`; `A/strings/reductions/r03-replacement-captures.safejs`; `A/strings/reductions/r04-replacement-context.safejs`.
- **Reproduction/evidence pointers:** `A/strings/reductions/r03-replacement-captures.safejs`; `A/method-semantics-review/results.json#/findings/0`.
- **Spec confidence:** express — strong named regex-aware method semantics within subset. Authored template integration is not a full Mustache package run. Five token-offset differences belong to STR-01, not substitution expansion. Independent invalid entryPointArgs driver attempt is not a runtime witness.

#### 12. STR-04 — P2

- **STR-04 — Global regex cursor semantics repeat or retain scan positions.** Expected: matchAll one match from cursor 2; match/replace reset cursor to 0 Actual: matchAll two matches; cursor remains 2 after match/replace
- **Original associated case IDs (including retained controls):** `strings:r05-global-lastindex`.
- **Original entry paths:** `A/strings/reductions/r05-global-lastindex.safejs`.
- **Reproduction/evidence pointers:** `A/strings/reductions/r05-global-lastindex.safejs`; `A/method-semantics-review/results.json`.
- **Spec confidence:** express — strong named regex-aware method coverage. afterMatchAll=2 is correct in both. Wrong fields are extra matchAll match and afterMatch/afterReplace remaining 2 rather than 0. Match/replace text itself passes; no replay or substantial downstream work-loss claim.

#### 13. LANG-01 — P2

- **LANG-01 — Read-only callback composition is rejected by the receiver guard.** Expected: Nested read-only reduce returns 36; Cartesian rank totals 1100 Actual: Fatal reentry after 25 and 595 steps respectively; no source mutation required
- **Original associated case IDs (including retained controls):** `language:10-reduce-nested-readonly`, `language:12-typescript-cartesian-readonly-ranking`, `language:13-sort-catch-reduce-reentry`, `linear-algebra:02-householder-qr-least-squares.safejs`, `linear-algebra:read-only-nested-map.safejs`, `version-ranges:records:catalog-stable-carets`, `version-ranges:records:catalog-zero-carets`, `version-ranges:records:catalog-hyphen-x`, `version-ranges:records:catalog-or-any-null`, `version-ranges:records:catalog-prerelease-base-tuple`, `version-ranges:records:catalog-include-prerelease`, `version-ranges:records:selection-build-ties`, `version-ranges:records:selection-disjunction-negotiation`, `version-ranges:records:selection-empty-intersection`, `version-ranges:records:selection-catalog-hole`, `version-ranges:original-progress:catalog-stable-carets`, `iterable-pipelines:examples/01-buffer-window-zip`, `iterable-pipelines:examples/04-cartesian-traversal`, `iterable-pipelines:reductions/06-readonly-predicates`.
- **Original entry paths:** `A/language/reductions/10-reduce-nested-readonly.mjs`; `A/language/examples/12-typescript-cartesian-readonly-ranking.mjs`; `A/language/reductions/13-sort-catch-reduce-reentry.mjs`; `A/linear-algebra/examples/02-householder-qr-least-squares.safejs`; `A/linear-algebra/reductions/read-only-nested-map.safejs`; `A/version-ranges/cases/range-records.ajs`; `A/version-ranges/cases/range-original-progress.ajs`; `A/iterable-pipelines/examples/01-buffer-window-zip.js`; `A/iterable-pipelines/examples/04-cartesian-traversal.js`; `A/iterable-pipelines/reductions/06-readonly-predicates.js`.
- **Reproduction/evidence pointers:** `A/language/reductions/10-reduce-nested-readonly.mjs`; `A/language/results.json`; `A/iterable-pipelines/results.json`.
- **Spec confidence:** express — moderate-strong ordinary method composition. Expected totalScore=1100 and eight ranked rows; actual reentry refusal. No claim that ordinary sorting is broken or silent data was returned. Mechanism inference does not convert a guard into a normative language exclusion.
- **Aliases/related manifestations:** `IP-001`, `LA-L1`; keep original family labels and evidence, without inflating cause counts.

#### 14. CONTEXTUAL-FROM — P2

- **TREE-01 — Contextual from is rejected in ordinary key and binding positions.** Expected: Native accepts unquoted from key and binding; full virtual-dom sibling reconciliation matches the quoted-key control, and binding reduction returns {value:2,dotted:2}. Actual: Unexpected token 'from' before execution (zero Budget steps): full tree at 13:14, binding control at 3:9; quoted tree passes full output. Quaternion original/reduction corroborate the binding context.
- **Original associated case IDs (including retained controls):** `tree-reconciliation:02-append`, `tree-reconciliation:02-prepend`, `tree-reconciliation:02-remove`, `tree-reconciliation:02-rotate`, `tree-reconciliation:02-mixed`, `tree-reconciliation:02-replace-all`, `tree-reconciliation:02-unkeyed`, `tree-reconciliation:02-reverse`, `tree-reconciliation:reduced-from-property`, `linear-algebra:04-quaternion-slerp-rotate.safejs`, `linear-algebra:contextual-from-binding.safejs`, `data-pipelines:patch-sequence`, `data-pipelines:patch-backward-move`, `data-pipelines:patch-root-replace`, `data-pipelines:patch-failed-test`.
- **Original entry paths:** `A/tree-reconciliation/02-virtual-dom-reorder.ajs`; `A/tree-reconciliation/reduced-from-property.ajs`; `A/linear-algebra/examples/04-quaternion-slerp-rotate.safejs`; `A/linear-algebra/reductions/contextual-from-binding.safejs`; `A/data-pipelines/json-patch.ajs`.
- **Reproduction/evidence pointers:** `A/parser-diagnostics-review/COMMANDS.md`; `A/parser-diagnostics-review/results.json`; `A/data-pipelines-review/results.json#/findings/0`.
- **Spec confidence:** derived — moderate ordinary grammar inference. Quoted/dotted and renamed compatible controls differ from failed contextual token uses. Planned delivered syntax and tokenizer implementation are not a universal grammar promise. Ordinary patch-test Error is distinct from ParseError before execution.
- **Aliases/related manifestations:** `DP-1`, `LA-01`, `PDR-01`; keep original family labels and evidence, without inflating cause counts.

#### 15. OBJ-003 — P2

- **OBJ-003 — Object.fromEntries rejects supported collection iterables.** Expected: {first:{count:1},second:2} from Map or finite source generator Actual: TypeError: object is not iterable (cannot read property Symbol(Symbol.iterator)); array control passes
- **Original associated case IDs (including retained controls):** `objects:pick-map-entries`, `objects:pick-generator-entries`, `objects:from-entries-map`, `objects:from-entries-generator`.
- **Original entry paths:** `A/objects/lodash-pick-iterable.ajs`; `A/objects/reductions/from-entries-iterable.ajs`.
- **Reproduction/evidence pointers:** `A/objects/reductions/from-entries-iterable.ajs`; `A/objects/results.json`.
- **Spec confidence:** express — strong named fromEntries plus supported iterable types. Both exercised branches fail at fromEntries before output/alias postconditions. The projection wrapper is audit-authored around adapted code, not a full library certification. No generator checkpoint/replay claim.

#### 16. MC-001 — P2

- **MC-001 — Documented Infinity is rejected by the actual harness lint gate.** Expected: Documented Infinity recognized by lint; actual runHarness not rejected at those two identifiers. Actual: Actual runHarness throws LintError/AS003 at Infinity lines85/92 twice, before any metric calls; rewritten source has no constructor lint errors.
- **Original associated case IDs (including retained controls):** `module-composition:graph-compatible--object-object`.
- **Original entry paths:** `A/module-composition/variants/graph-compatible.safejs`.
- **Reproduction/evidence pointers:** `A/module-composition-review/commands.md`; `A/module-composition-review/results.json`.
- **Spec confidence:** express — strong exact global plus lint-name guarantee. Full compatible graph has no constructor-lint error; original module setup/modulesFor already occurs. Actual runHarness gate is confirmed, not inferred solely from standalone lint.

#### 17. STR-02 — P2

- **STR-02 — Unsuccessful global match returns a truthy empty array.** Expected: {isNull:true,value:null} Actual: {isNull:false,value:[]}
- **Original associated case IDs (including retained controls):** `strings:r06-no-global-match`.
- **Original entry paths:** `A/strings/reductions/r06-no-global-match.safejs`.
- **Reproduction/evidence pointers:** `A/strings/reductions/r06-no-global-match.safejs`; `A/functional-review/results.json#/records/5`.
- **Spec confidence:** express — strong explicit match method coverage. null versus [] changes truthiness, but an actual consuming application branch/work loss was not executed in the reviewed witness. Keep the demonstrated impact small without weakening explicit method coverage.

#### 18. STR-05 — P2

- **STR-05 — Captured zero-width split includes a spurious element.** Expected: captured:["a","b",""] Actual: Captured split is ["a","b","",undefined], with a fourth own undefined slot, not null or a hole. Four neighboring reduced fields match.
- **Original associated case IDs (including retained controls):** `strings:r07-zero-width-split`.
- **Original entry paths:** `A/strings/reductions/r07-zero-width-split.safejs`.
- **Reproduction/evidence pointers:** `A/strings/reductions/r07-zero-width-split.safejs`; `A/method-semantics-review/results.json`.
- **Spec confidence:** express — strong explicit split method coverage. Actual captured result is [a,b,empty,own undefined] rather than [a,b,empty]. It is not null or an array hole. Four neighboring subcases and the substantial table control pass.

#### 19. HI-002 — P2

- **HI-002 — SDK Markdown diagnostic spans omit the non-newline leading prefix.** Expected: Original Markdown absolute UTF-16 offsets: graph 967; AS003 reduction 214; runtime throw 831, with original line/column Actual: Offsets 886, 156, 757 while line/column match; direct full-prefix control returns correct 214. Expected lint/runtime errors are not themselves defects.
- **Original associated case IDs (including retained controls):** `harness-integration:02-markdown-dag::direct::base`, `harness-integration:02-markdown-dag::sdk::base`, `harness-integration:04-markdown-generator::direct::base`, `harness-integration:04-markdown-generator::direct::runtime-md`, `harness-integration:04-markdown-generator::sdk::base`, `harness-integration:04-markdown-generator::sdk::wrapped-error`, `harness-integration:04-markdown-generator::sdk::runtime-md`, `harness-integration:07-block-await::direct::base`, `harness-integration:07-block-await::sdk::base`, `harness-integration:08-offset::direct::base`, `harness-integration:08-offset::sdk::base`.
- **Original entry paths:** `A/harness-integration/examples/02-markdown-dag.md`; `A/harness-integration/examples/04-markdown-generator.md`; `A/harness-integration/variants/04-markdown-runtime-error.md`; `A/harness-integration/rewrites/04-runtime-error.md`; `A/harness-integration/reductions/07-block-await.md`; `A/harness-integration/reductions/08-offset.md`.
- **Reproduction/evidence pointers:** `A/harness-integration/REPORT.md`; `A/parser-diagnostics-review/results.json`.
- **Spec confidence:** derived — moderate SDK absolute-prefix inference; explicit original-line guarantee passes. D01 offsets 831/880 become 757/806 while line41 columns1/50 remain correct; D02 deficit58, astral61, CRLF68. Inter-block masking is not the failed part. No actual wrong edit or CLI corruption; CRLF supplementary evidence uses a reader stub.
- **Aliases/related manifestations:** `PDR-02`; keep original family labels and evidence, without inflating cause counts.

#### 20. CTX-001 — P2

- **CTX-001 — Array map/forEach omit supplied callback receiver and reject tested calls.** Expected: Each callback sees the supplied context and original source array; products [6,15,-3,+0], indices0–3, sameContext/sameArray true, unchanged values and context. Actual: Four author and four independent SafeJS runs reject run() Promise with TypeError: Cannot read properties of null or undefined. All six valid native controls and all four explicit callback.call SafeJS controls match complete expected values and identities.
- **Original associated case IDs (including retained controls):** `callback-context-controls:map-thisarg`, `callback-context-controls:foreach-thisarg`.
- **Original entry paths:** `A/callback-context-controls/sources/01-map-thisarg.ajs`; `A/callback-context-controls/sources/02-foreach-thisarg.ajs`.
- **Reproduction/evidence pointers:** `A/callback-context-review/COMMANDS.md`; `A/callback-context-review/results.json#/finding`.
- **Spec confidence:** express — strong-broad-qualified. Broad express README method coverage and runtime this support inherit ordinary receiver semantics; thisArg is not individually listed and full ECMAScript conformance is not claimed. Three synthetic API controls, zero OSS algorithms or substantial workflows. Unexpected runtime rejection only; no linter assertion, silent output corruption, or proven substantial-workflow impact. Separate from reentry and public-Promise findings.

#### 21. MC-002 — P3

- **MC-002 — Repeated namespace containers differ without an established singleton contract.** Expected: Repeated native namespace imports compare equal; ordinary imported data/function aliases remain stable. Actual: Namespace containers compare false; cached data/default/named/callable aliases and call order match. No express singleton identity guarantee established.
- **Original associated case IDs (including retained controls):** `module-composition:graph--object-object`, `module-composition:graph--map-map`, `module-composition:graph--object-map`, `module-composition:graph--map-object`, `module-composition:graph-compatible--object-object`, `module-composition:namespace-identity--object-object`.
- **Original entry paths:** `A/module-composition/examples/graph.safejs`; `A/module-composition/variants/graph-compatible.safejs`; `A/module-composition/reductions/namespace-identity.safejs`.
- **Reproduction/evidence pointers:** `A/module-composition-review/commands.md`; `A/module-composition-review/results.json`.
- **Spec confidence:** compatibility-only — high observed difference; namespace singleton guarantee unestablished. No declared intentional singleton exclusion either: absence of guarantee means compatibility-only, not intentional behavior ratification. Exported data/function/default/named aliases remain correct; no lost update or consumer branch damage shown.

## Unranked and historical scope rows

Every row remains in the ledger even when the baseline disposition is closed, unsupported or nonbug. A historical closed runtime candidate can still have an actionable documentation qualification. All current review/work gates start pending unless the ranked handoff explicitly states otherwise. Ledger-only labels below are not new audit finding IDs.

| Row | IDs / label | Baseline classification | Current assignment | R / I / V / C / P / L |
| --- | --- | --- | --- | --- |
| U01 | `PPR-001` | Unranked functional candidate | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| U02 | `IP-002` | Unranked functional candidate | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| D01 | `HI-001` | Historical documentation/installed-skill drift | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| D02 | `AR-002` | Historical API documentation clarification | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| D03 | `AR-003` | Historical documentation-too-broad | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O01 | `MUTATION-GUARD; COLL-002; LANG-02` | Intentional restriction with documentation qualification | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O02 | `EAGER-ENUMERATION` | Documented nonbug/control | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O03 | `REGEX-SUBSET` | Unsupported syntax plus documentation gap | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O04 | `LINT-RUNTIME; LINT-01` | Historical lint/runtime policy distinction | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O05 | `ASYNC-PROOF-FIXTURES` | Corrected fixtures plus unresolved proof ergonomics | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O06 | `PREWRAPPED-REPLAY-CORRECTION` | Already-corrected audit expectation/nonbug | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O07 | `RUN-RESULT-SHAPE-DOC; SCHEMA-API-002` | Closed runtime candidate; open documentation qualification | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O08 | `NUM-003; DECIMAL-CALLABLE-CUSTOMIZATION` | Unsupported callable writes/documentation qualification | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O09 | `BINARY-IN; TREE-02; SCHEMA-IN-001` | Documented intentional subset restriction | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O10 | `CANCEL-OBS-01` | Unresolved representation observation, not confirmed replay corruption | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O11 | `EDITOR-ORIGINAL-EXPECTATIONS (ledger label)` | Baseline documented lint and known-channel nonbugs | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O12 | `INPUT-ERROR-PROJECTION (ledger label)` | Baseline incomplete proof representation/nonbug | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O13 | `RAW-PROMISE-PENDING-WATCHDOGS (ledger label)` | Unresolved functional candidate, no confirmed cause | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O14 | `ADAPTER-CHAIN-LIFECYCLE (ledger label)` | Unresolved journal/lifecycle functional qualification | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O15 | `RANDOM-TIME-NATIVE-PREFLIGHT (ledger label)` | Coverage-only unresolved rows, not observed product failures | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O16 | `INDEXED-DEADLINE-INCOMPLETE (ledger label)` | Unresolved bounded-attempt observation | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O17 | `CAMERA-TYPED-NATIVE-ONLY (ledger label)` | Coverage-only unresolved rows | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O18 | `COVERAGE-CAPTURE-LIMITS (ledger label)` | Evidence limitations, not additional product defects | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O19 | `IV5-01; IV9-01; IV10-01; SOURCE-MAP-COMMAND/PLAN-LOCATION REPAIRS` | Already-closed historical audit/documentation repairs | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O20 | `EXPECTED-ERROR-CONTROLS (ledger label)` | Expected application/API refusals and unsupported controls | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |
| O21 | `HISTORICAL-POLICY/PROVENANCE-ATTRIBUTION (ledger label)` | Audit attribution qualification | Pending; no worker assigned | pending / pending / pending / pending / pending / pending |

### U01 — PPR-001

- **Baseline evidence:** Four original raw-Promise configurations split aliases: full aliases [true,true,true,true] become [false,false,false,true]; scalar balance remains 13; alias control loses sameAlias and markerVisible. No repeated external side effect shown.
- **Spec/evidence confidence:** Derived preconversion alias expectation; independently observed, not an express native-Promise identity guarantee.
- **Original case IDs:** `public-promise-recovery:full-pending-uninterrupted`, `public-promise-recovery:full-prefulfilled-uninterrupted`, `public-promise-recovery:alias-entryPointArgs`, `public-promise-recovery:alias-bindings`.
- **Original entry paths:** `A/public-promise-recovery/01-public-input-scan.ajs`; `A/public-promise-recovery/02-public-promise-alias-control.ajs`.
- **Evidence paths:** `A/public-promise-review/results.json#/rows/4`; `A/public-promise-recovery/results.json`; `A/public-promise-review/REPRODUCE.md`.
- **Explicit disposition:** Pending current reproduction and contract resolution by assigned fix/validation subagents. Keep actionable; absence of an express promise is not a wont-fix decision. Do not merge with nonaliased PPR-002 or substitute preadapted inputs.

### U02 — IP-002

- **Baseline evidence:** Original tee rejects at 54:5 and return-method reduction at 5:3, zero guest steps; computed-key and close/async controls pass. Failure is recorded API rejection even when child exit is zero.
- **Spec/evidence confidence:** Derived ordinary object grammar; independent keyword-method confirmation supersedes historical author-only wording.
- **Original case IDs:** `iterable-pipelines:examples/03-tee-shared-cache`, `iterable-pipelines:reductions/07-return-method`.
- **Original entry paths:** `A/iterable-pipelines/examples/03-tee-shared-cache.js`; `A/iterable-pipelines/reductions/07-return-method.js`.
- **Evidence paths:** `A/iterable-pipelines/results.json#/findings/1`; `A/keyword-method-review/results.json`; `A/keyword-method-review/COMMANDS.md`; `A/keyword-method-review/contract-classification.json`.
- **Explicit disposition:** Pending current reproduction and contract resolution; retain actionable parser discrepancy. No arbitrary-keyword guarantee inferred and no automatic merge with TREE-01/contextual binding grammar.

### D01 — HI-001

- **Baseline evidence:** Eight original direct/SDK associations include Markdown DAG, generator and block-await variants. Audit-time braced module-level await was refused by lint, not by direct interpretation.
- **Spec/evidence confidence:** Historical AS008 restriction/installed-template conflict; current tracked docs expressly allow nested top-level await.
- **Original case IDs:** `harness-integration:02-markdown-dag::direct::base`, `harness-integration:02-markdown-dag::sdk::base`, `harness-integration:04-markdown-generator::direct::base`, `harness-integration:04-markdown-generator::direct::runtime-md`, `harness-integration:04-markdown-generator::sdk::base`, `harness-integration:04-markdown-generator::sdk::runtime-md`, `harness-integration:07-block-await::direct::base`, `harness-integration:07-block-await::sdk::base`.
- **Original entry paths:** `A/harness-integration/examples/02-markdown-dag.md`; `A/harness-integration/examples/04-markdown-generator.md`; `A/harness-integration/variants/04-markdown-runtime-error.md`; `A/harness-integration/reductions/07-block-await.md`.
- **Evidence paths:** `A/harness-integration/results.json#/attempts/7`; `A/harness-integration/results.json#/attempts/19`; `A/harness-integration/results.json#/attempts/37`; `A/harness-integration/REPORT.md`.
- **Explicit disposition:** Pending independent current reconciliation, not a new confirmed interpreter defect and not already runtime-validated closed. Current README:135 and SKILL_safejs.md:88 now agree; installed external skill state was not inspected. Future skill edits belong in SKILL_ template, then npm run sync-skills; no README edit without permission.

### D02 — AR-002

- **Baseline evidence:** Prewrapped capability control obtains dumpCurrent snapshot while dump waits for a future yield; result/replay matches. Prewrapped calls bypass ordinary journal wrapping.
- **Spec/evidence confidence:** Strong API timing distinction; a 100 ms pending observation is not proof of deadlock.
- **Original case IDs:** `async-replay:10-external-dump::sandbox-closure`.
- **Original entry paths:** `A/async-replay/reductions/10-external-dump.js`.
- **Evidence paths:** `A/async-replay/results.json#/externalDumpTimedRuns/1`; `A/async-replay/reductions/10-external-dump.js`.
- **Explicit disposition:** Pending independent current reconciliation. README:274 now documents next-yield behavior; snapshot/dump.ts retains separate requestCurrentSnapshot/requestSnapshot paths. Do not call this AR-001 repair or a deadlock; document any remaining usage gap outside README unless authorized.

### D03 — AR-003

- **Baseline evidence:** Audit source generator examples snapshot/replay successfully despite the blanket suspended-generator restriction. Current README:330 and SKILL_safejs.md:111 still state that broad limitation; CHECKPOINT_REPLAY.md:74-75 addresses opaque native/live generator codec limits.
- **Spec/evidence confidence:** Source-generator snapshot successes are observed; arbitrary host-generator serialization is not established.
- **Evidence paths:** `A/async-replay/results.json#/snippets/6`; `A/async-replay/results.json#/snippets/7`.
- **Explicit disposition:** Pending scoped current validation and documentation reconciliation; retain actionable drift, without promising arbitrary host generator capture or editing README in this assignment.

### O01 — MUTATION-GUARD; COLL-002; LANG-02

- **Baseline evidence:** Map forEach worklist and reduce/self-mutation cases hit conservative structural-mutation guards. This is not the read-only LANG-01 defect.
- **Spec/evidence confidence:** Strong baseline guard distinction; current documentation completeness unverified.
- **Original case IDs:** `collections:09-map-foreach-worklist`, `language:03-typescript-stable-sort-reduce`, `language:07-reduce-self-mutation`.
- **Original entry paths:** `A/collections/09-map-foreach-worklist.ajs`; `A/language/examples/03-typescript-stable-sort-reduce.mjs`; `A/language/reductions/07-reduce-self-mutation.mjs`.
- **Evidence paths:** `A/collections/results.json#/cases/8`; `A/language/results.json#/records/2`; `A/language/results.json#/records/6`.
- **Explicit disposition:** Retain documented/intentional restriction separately; pending reconciliation of the recorded documentation gap. Do not remove guards as an incidental COLL-001 or LANG-01 fix.

### O02 — EAGER-ENUMERATION

- **Baseline evidence:** Explicit enumeration returns eager arrays; that restriction does not justify default Map/Set for-of snapshots.
- **Spec/evidence confidence:** Express intentional eager keys/values/entries behavior.
- **Evidence paths:** `A/collections/results.json#/cases/13`; `A/set-iteration-review/results.json`.
- **Explicit disposition:** Preserve passing eager-method control during COLL-001 independent validation. No separate implementation proposed; no live-iterator guarantee generalized beyond tested direct iteration.

### O03 — REGEX-SUBSET

- **Baseline evidence:** Six c01-c06 rejection controls retain their original labels. Audit notes Unicode/sticky flag refusals extend beyond the documented Unicode-property restriction.
- **Spec/evidence confidence:** Express exclusions for lookaround/backreferences/named groups/property escapes; u/y refusal has narrower documentary support.
- **Original case IDs:** `strings:c01-marked-lookaround`, `strings:c02-marked-backreference`, `strings:c03-named-group`, `strings:c04-minimatch-unicode-property`, `strings:c05-unicode-flag`, `strings:c06-sticky-flag`.
- **Original entry paths:** `A/strings/reductions/c01-marked-lookaround.safejs`; `A/strings/reductions/c02-marked-backreference.safejs`; `A/strings/reductions/c03-named-group.safejs`; `A/strings/reductions/c04-minimatch-unicode-property.safejs`; `A/strings/reductions/c05-unicode-flag.safejs`; `A/strings/reductions/c06-sticky-flag.safejs`.
- **Evidence paths:** `A/strings/results.json#/cases/7`; `A/strings/results.json#/cases/12`.
- **Explicit disposition:** Unsupported constructs are not ranked defects; pending current reconciliation of u/y behavior and documentation gap. Do not silently treat unpromised flags as intentional or broaden this into regex conformance work. Archived budget probes remain excluded.

### O04 — LINT-RUNTIME; LINT-01

- **Baseline evidence:** Immer patch switch/finally workflow succeeds directly but was lint-rejected in the audit.
- **Spec/evidence confidence:** Baseline switch refusal was policy, not runtime failure; current docs explicitly support switch.
- **Original case IDs:** `language:05-immer-patches-switch-finally`.
- **Original entry paths:** `A/language/examples/05-immer-patches-switch-finally.mjs`.
- **Evidence paths:** `A/language/results.json#/records/4`.
- **Explicit disposition:** Pending current policy reconciliation; keep audit-era nonbug distinct from actual current behavior. README:135 and template:86 now list switch; no current rerun occurred.

### O05 — ASYNC-PROOF-FIXTURES

- **Baseline evidence:** Initial retry gating changed order; corrected per-call proof values restore equality. Function-bearing external-proof result usage remains an open qualification, not general replay corruption.
- **Spec/evidence confidence:** Corrected per-call proof ordering matches; function-bearing proof result ergonomics unresolved.
- **Evidence paths:** `A/async-replay/results.json#/schedulerBoundaries/1`; `A/async-replay/results.json#/correctedBoundaries/0`; `A/async-replay/results.json#/correctedBoundaries/1`; `A/async-replay/results.json#/correctedBoundaries/3`.
- **Explicit disposition:** Corrected ordering mismatch is baseline nonbug; retain function-bearing proof ergonomics for pending targeted triage. Do not drop that unresolved sub-observation or promote the fixture mistake to a runtime cause.

### O06 — PREWRAPPED-REPLAY-CORRECTION

- **Baseline evidence:** Prewrapped sandbox closures replay equal values but repeat two stub calls because they bypass ordinary wrapping; ordinary injected-function controls separately add zero replay calls.
- **Spec/evidence confidence:** Independent fixture correction.
- **Evidence paths:** `A/functional-review/results.json#/expectationCorrections/0`.
- **Explicit disposition:** Historical expectation correction is closed, not a shipped product fix. Preserve boundary distinction in AR-002/AR-001 validation; no universal zero-repeat claim.

### O07 — RUN-RESULT-SHAPE-DOC; SCHEMA-API-002

- **Baseline evidence:** Direct-run shape-dependent completion/rejection behavior is reproduced and explained. Ordinary application errors reject; unsupported in can resolve an interpreter error or reject by source shape. Awaited unsupported control resolves ok:false.
- **Spec/evidence confidence:** Independent 24-child channel assessment; public resolved-error wording is not a universal failure-channel promise.
- **Evidence paths:** `A/error-channel-review/results.json#/disposition`; `A/error-channel-review/REPORT.md`; `A/functional-review/results.json#/records/3`; `A/functional-review/results.json#/records/6`; `A/schema-transforms/results.json#/findings/1`.
- **Explicit disposition:** SCHEMA-API-002 is already closed as a new runtime defect at audit baseline; documentation/API-usage qualification remains pending. Current README:265-268 still only lists resolved shapes. No blanket source-shape invariance or new runtime regression asserted.

### O08 — NUM-003; DECIMAL-CALLABLE-CUSTOMIZATION

- **Baseline evidence:** Histogram callable configuration throws before arithmetic; two d3 formatter originals and custom-string reduction remain unsupported while core rewrites and big.js match. Distinct from derived read-only function.length NUM-001.
- **Spec/evidence confidence:** Observed unsupported callable configuration; no express function-own-write contract established.
- **Original case IDs:** `numerics:03-histogram-configured-closures`, `numerics:12-callable-property-reduction`, `decimal-formatting:01-d3-locale-formatting.safejs`, `decimal-formatting:02-d3-axis-precision.safejs`, `decimal-formatting:formatter-custom-string.safejs`.
- **Original entry paths:** `A/numerics/03-histogram-configured-closures.ajs`; `A/numerics/12-callable-property-reduction.ajs`; `A/decimal-formatting/examples/01-d3-locale-formatting.safejs`; `A/decimal-formatting/examples/02-d3-axis-precision.safejs`; `A/decimal-formatting/reductions/formatter-custom-string.safejs`.
- **Evidence paths:** `A/numerics/results.json#/findings/2`; `A/decimal-formatting/results.json`.
- **Explicit disposition:** Keep unsupported cases separate from arithmetic defects; pending documentation/subset reconciliation rather than silent dismissal. Do not infer unsupported source callable writes from captured callable property-data support.

### O09 — BINARY-IN; TREE-02; SCHEMA-IN-001

- **Baseline evidence:** Tree and schema originals exercise the same excluded operator; own-field rewrites only cover the own-property domain, not prototype-bearing objects.
- **Spec/evidence confidence:** Explicit unsupported binary in, not a newly discovered accidental defect.
- **Evidence paths:** `A/tree-reconciliation/results.json#/findings/1`; `A/schema-transforms/results.json#/findings/0`; `A/error-channel-review/results.json`.
- **Explicit disposition:** Retain unsupported classification, not an implementation queue expansion. Keep originals and bounded rewrite scope; channel qualification belongs to O07.

### O10 — CANCEL-OBS-01

- **Baseline evidence:** Public binding views reflect local finally cleanup; replay history/input graph remain unchanged. Six unresolved case rows preserve strict snapshot mismatch.
- **Spec/evidence confidence:** Twelve snapshot-equality failures but 24 fresh resumes preserve values/call suffixes.
- **Original case IDs:** `cancellation-replay:map::two-workers`, `cancellation-replay:map::verify`, `cancellation-replay:graph::computed`, `cancellation-replay:graph::review`, `cancellation-replay:scan::replacement`, `cancellation-replay:scan::unseeded-fold`.
- **Original entry paths:** `A/cancellation-replay/01-bounded-map.ajs`; `A/cancellation-replay/02-dijkstra-heap.ajs`; `A/cancellation-replay/03-scan-reduce.ajs`.
- **Evidence paths:** `A/cancellation-replay/results.json#/findings`; `A/cancellation-replay/cancellation-snapshot-comparison.json`.
- **Explicit disposition:** Pending representation-contract reconciliation. Do not erase original strict failures or assert general harmlessness; no corruption implementation proposed without evidence.

### O11 — EDITOR-ORIGINAL-EXPECTATIONS (ledger label)

- **Baseline evidence:** C1-C4 originals use new Error under audit-time constructor lint; C4 also assumes wrong default-entry error envelope. Current docs now permit sandbox constructors, so historical policy is not current reproduction.
- **Spec/evidence confidence:** Eight original mismatches explained; eight compatible API executions meet expectations.
- **Original case IDs:** `editor-runner-composition:C1`, `editor-runner-composition:C2`, `editor-runner-composition:C3`, `editor-runner-composition:C4`.
- **Original entry paths:** `A/editor-runner-composition/examples/02-config-dependencies.ajs`.
- **Evidence paths:** `A/editor-runner-composition/cases.json#/fixtures/3`; `A/editor-runner-composition/cases.json#/fixtures/6`; `A/editor-runner-composition/results.json`; `A/editor-runner-composition/REPRODUCE.md`.
- **Explicit disposition:** Preserve original FAILs and compatible controls; no new product defect at baseline. Pending current policy reconciliation with D01/O04/O07 through authorized issue-validation runs, not unsolicited coverage expansion.

### O12 — INPUT-ERROR-PROJECTION (ledger label)

- **Baseline evidence:** reject-right-first retains two minimal-Error identity/trace mismatches; other values and proof counts match. Separate controls with the captured complete Error pass.
- **Spec/evidence confidence:** Full name/message/stack proof control restores equality; minimal projection does not.
- **Original case IDs:** `input-promise-recovery:reject-right-first`.
- **Original entry paths:** `A/input-promise-recovery/01-input-batch-scan.ajs`.
- **Evidence paths:** `A/input-promise-recovery/expectations.json#/profiles/1`; `A/input-promise-recovery/representation-assessment.json`; `A/input-promise-recovery/results.json`.
- **Explicit disposition:** No separate input-recovery defect; retain original failures and full-proof control as context for AW-001/AW-002. Do not use the internal createSandboxPromise setup to claim raw public-Promise success.

### O13 — RAW-PROMISE-PENDING-WATCHDOGS (ledger label)

- **Baseline evidence:** Held/immediate after-left, both-pending immediate, and missing-provider configurations have no successful resumes. Returned matching proofs do not prove consumption; missing-provider watchdog is not an observed expected refusal.
- **Spec/evidence confidence:** Six author plus two independent watchdogs; proof consumption unobserved.
- **Original case IDs:** `public-promise-recovery:pending-after-left-held-proofs`, `public-promise-recovery:pending-after-left-immediate-proofs`, `public-promise-recovery:pending-both-pending-immediate-proofs`, `public-promise-recovery:pending-missing-provider`.
- **Original entry paths:** `A/public-promise-recovery/01-public-input-scan.ajs`.
- **Evidence paths:** `A/public-promise-recovery/results.json`; `A/public-promise-review/results.json`.
- **Explicit disposition:** Pending targeted current triage with its own evidence before any cause assignment. Retain as unresolved actionable investigation, not a PPR-002 merge, pass, expected refusal, or security/deadline stress campaign.

### O14 — ADAPTER-CHAIN-LIFECYCLE (ledger label)

- **Baseline evidence:** Five corpus configurations retain FAILs: six author adapter, two independent adapter and four author chain completed/prefulfilled restores differ settled-versus-consumed. Chain has eight lifecycle-row differences, including false consumed anchors and whole-journal flags.
- **Spec/evidence confidence:** Twelve retained qualified children; workflow equality does not establish journal correctness.
- **Original case IDs:** `public-promise-adaptation:full-prefulfilled-after-left-restore`, `public-promise-adaptation:full-prefulfilled-both-pending-restore`, `public-promise-adaptation:single-completed-restore`, `public-promise-chain:prefulfilled-resume-a`, `public-promise-chain:prefulfilled-resume-b`.
- **Original entry paths:** `A/public-promise-adaptation/01-public-input-scan.ajs`; `A/public-promise-adaptation/03-single-public-input-recovery.ajs`; `A/public-promise-chain/01-public-input-scan.ajs`.
- **Evidence paths:** `A/public-promise-adaptation/results.json`; `A/public-promise-adaptation/single-gate-assessment.json`; `A/public-promise-adaptation-review/lifecycle-assessment.json`; `A/public-promise-chain/results.json`; `A/public-promise-chain/B-progress-and-lineage.json`.
- **Explicit disposition:** Pending contract/behavior triage; preserve failed journal assertions, not globally harmless or all-pass. Alternate deepCopyToSandbox initial construction creates different checkpoints; it neither fixes PPR-001/PPR-002 nor validates original raw checkpoints.

### O15 — RANDOM-TIME-NATIVE-PREFLIGHT (ledger label)

- **Baseline evidence:** Retry planner seed123/seed42 original preflights remain unresolved-for-SafeJS; adapted run coverage is separate.
- **Spec/evidence confidence:** Two native-only originals pass; no SafeJS executions for these configurations.
- **Original case IDs:** `random-time-replay:03-retry-planner-seed-123-preflight-original`, `random-time-replay:03-retry-planner-seed-42-preflight-original`.
- **Original entry paths:** `A/random-time-replay/originals/03-retry-planner-locale.js`.
- **Evidence paths:** `A/random-time-replay/results.json#/native/6`; `A/random-time-replay/results.json#/native/8`.
- **Explicit disposition:** Retain native-only coverage limitation, not PASS and not an invented defect or new test campaign.

### O16 — INDEXED-DEADLINE-INCOMPLETE (ledger label)

- **Baseline evidence:** Eight original radix and two diagnostic attempts stop at deadlines; unchanged-source bounded retries complete the eight business fixtures twice. Instrumented branch-split-progress has only native completion and partial SafeJS progress.
- **Spec/evidence confidence:** Sixteen completed SafeJS passes plus ten incomplete attempts; no performance SLA established.
- **Original case IDs:** `indexed-structures:radix-branch-split-progress`.
- **Original entry paths:** `A/indexed-structures/cases/radix-progress.ajs`.
- **Evidence paths:** `A/indexed-structures/results.json#/deadlineClassification/diagnostics`; `A/indexed-structures/REPORT.md`.
- **Explicit disposition:** Pending targeted timeout classification if actionable at current revision; retain incomplete attempts, never count partial output as pass. No inference of infinite loop, performance regression, or security issue; no runtime here.

### O17 — CAMERA-TYPED-NATIVE-ONLY (ledger label)

- **Baseline evidence:** Axis-frustum, oblique-frame and offset-handoff typed configurations are native-only; nine SafeJS-eligible variants pass twice. acosh has zero executed calls.
- **Spec/evidence confidence:** Three typed-camera native baselines, no SafeJS attempts.
- **Original case IDs:** `inverse-coordinate-transforms:camera-axis-frustum-typed`, `inverse-coordinate-transforms:camera-oblique-frame-typed`, `inverse-coordinate-transforms:camera-offset-handoff-typed`.
- **Original entry paths:** `A/inverse-coordinate-transforms/cases/camera-typed.ajs`.
- **Evidence paths:** `A/inverse-coordinate-transforms/cases.json#/6`; `A/inverse-coordinate-transforms/cases.json#/8`; `A/inverse-coordinate-transforms/cases.json#/10`; `A/inverse-coordinate-transforms/REPORT.md`.
- **Explicit disposition:** Retain coverage gaps, not runtime failures or implementation requests. Do not credit fround adaptation as typed-original execution or unexecuted helpers as coverage.

### O18 — COVERAGE-CAPTURE-LIMITS (ledger label)

- **Baseline evidence:** CTX-001 is three synthetic controls, not an OSS workflow; receiver source-discovery gap remains. Three historical Markdown stdout fragments remain unavailable; invalid drivers, setup errors, partial watchdog outputs and native-only references are not product results.
- **Spec/evidence confidence:** Master report explicitly preserves missing/invalid/partial evidence and synthetic scope.
- **Evidence paths:** `A/REPORT.md`; `A/SNIPPETS.md`; `A/inventory-verification.json`.
- **Explicit disposition:** Keep limitations explicit; do not invent missing output, claim whole-upstream/full-ECMAScript coverage, or start unsolicited coverage workloads. Authorized functional remediation reproductions and issue-validation runs remain permitted. Async generators and other explicitly excluded syntax remain restrictions rather than new findings.

### O19 — IV5-01; IV9-01; IV10-01; SOURCE-MAP-COMMAND/PLAN-LOCATION REPAIRS

- **Baseline evidence:** All 30 review-only configurations/93 children retain outcomes. Histogram basis and historical nineteen/current21 wording corrected; source-map command now uses returnValue on success; streaming/data QA plans moved to docs/plans. Source-map error/startup/timeout branches were not exercised.
- **Spec/evidence confidence:** Master inventory/verification records applied reporting corrections.
- **Evidence paths:** `A/inventory-verification.json#/IV5_01`; `A/inventory-verification.json#/IV9_01`; `A/inventory-verification.json#/IV10_01`; `A/source-maps-command-review/correction-record.json`; `A/source-maps-command-review/APPLICATION.md`; `A/streaming-sketches/plan-move-provenance.json`; `A/data-pipelines-review/plan-move-provenance.json`.
- **Explicit disposition:** Already corrected in historical audit, not production fixes or current independent release certification. No duplicate implementation queue; preserve untested-branch and audit-handoff limits.

### O20 — EXPECTED-ERROR-CONTROLS (ledger label)

- **Baseline evidence:** Cycle rejection, bad reducer/duplicate index, unclosed Markdown, deliberate wrapped/agent failures, missing declared-callback/concurrent provider dispositions and review ordinary errors are controls, not hidden new bugs. Regex controls map O03; subset in maps O09.
- **Spec/evidence confidence:** Prewritten error expectations with recorded bounded matches.
- **Evidence paths:** `A/SNIPPETS.md`; `A/inventory.json#/cases`; `A/inventory.json#/reviewOnlyOutcomes`.
- **Explicit disposition:** Retain all original expected-rejection/unsupported labels and passing controls. Do not reinterpret child exit0 as runtime success or collapse O13 missing-provider watchdog into these genuine refusals.

### O21 — HISTORICAL-POLICY/PROVENANCE-ATTRIBUTION (ledger label)

- **Baseline evidence:** Historical iterable-pipelines no-additional-agent attribution is unestablished. Coordinator-selected cutoffs, source lineage qualifications and old certification boundaries remain historical; later outside-cohort provenance bytes were not adopted.
- **Spec/evidence confidence:** Current user delegation policy is authoritative; prior worker no-nested-delegation is not a user prohibition.
- **Evidence paths:** `A/REPORT.md`; `A/inventory.json#/currentAttributionQualifications`; `A/inventory.json#/documentationRevisions`.
- **Explicit disposition:** Preserve attribution limits without changing the original audit or policy. Fix=subagent, independent validation=different subagent; no interpretation that the user disallowed agents.

## Alias and review-only reconciliation

- `DP-1`, `LA-01`, `PDR-01` → CONTEXTUAL-FROM / TREE-01; `DP-2` → ARRAY-OWN-METADATA; `CPC-01` → OBJ-002; `IP-001`, `LA-L1` → LANG-01; `PDR-02` → HI-002.
- `COLL-002`, `LANG-02` → O01 mutation restriction; `LINT-01` → O04 historical lint policy; `TREE-02`, `SCHEMA-IN-001` → O09 binary-in restriction. IP-002 remains U02, not automatically merged into TREE-01.
- Historical inventory fields saying Set or IP-002 were author-only do not override later independent Set/keyword reviews. The fromEntries-specific independent attribution gap is closed by the later review, not by assuming earlier chained operations isolated it.

| Review-only configurations | Count | Baseline labels | Master disposition |
| --- | ---: | --- | --- |
| `parser-diagnostics-review:T03` | 1 | FAIL | CONTEXTUAL-FROM / TREE-01 |
| `parser-diagnostics-review:D03` | 1 | PASS | Retained passing control; no new actionable defect |
| `parser-diagnostics-review:D04` | 1 | FAIL | HI-002 |
| `parser-diagnostics-review:D05` | 1 | FAIL | HI-002 |
| `callback-loss-review:counter-no-input` | 1 | MIXED | RETAINED-CALLBACK-DELIVERY / CBI-001; keep first-boundary failed resumes |
| `data-pipelines-review:compatible-lcs-records` | 1 | PASS | Retained passing control; no new actionable defect |
| `data-pipelines-review:compatible-lcs-duplicates` | 1 | PASS | Retained passing control; no new actionable defect |
| `data-pipelines-review:compatible-lcs-empty-left` | 1 | PASS | Retained passing control; no new actionable defect |
| `data-pipelines-review:compatible-patch-sequence` | 1 | PASS | Retained passing control; no new actionable defect |
| `data-pipelines-review:compatible-patch-backward-move` | 1 | PASS | Retained passing control; no new actionable defect |
| `data-pipelines-review:compatible-patch-root-replace` | 1 | PASS | Retained passing control; no new actionable defect |
| `data-pipelines-review:compatible-patch-failed-test` | 1 | expected-rejection | O20 expected application error control |
| `data-pipelines-review:diagnostic-patch-binding-only` | 1 | FAIL | CONTEXTUAL-FROM / TREE-01 |
| `data-pipelines-review:array-own-read` | 1 | FAIL | ARRAY-OWN-METADATA / DP-2 |
| `data-pipelines-review:array-extracted-call` | 1 | FAIL | ARRAY-OWN-METADATA / DP-2 |
| `data-pipelines-review:array-alternate-name` | 1 | FAIL | ARRAY-OWN-METADATA / DP-2 |
| `data-pipelines-review:object-record` | 1 | PASS | Retained passing control; no new actionable defect |
| `module-composition-review:graph-compatible::harness` | 1 | FAIL | MC-001; actual harness lint gate failure, not intentional exclusion |
| `error-channel-review:ordinary-top` | 1 | expected-rejection | O07/O20 expected application rejection |
| `error-channel-review:ordinary-default` | 1 | expected-rejection | O07/O20 expected application rejection |
| `error-channel-review:ordinary-await` | 1 | expected-rejection | O07/O20 expected application rejection |
| `error-channel-review:unsupported-top` | 1 | unsupported | O07 channel qualification and O09 binary-in unsupported |
| `error-channel-review:unsupported-default` | 1 | unsupported | O07 channel qualification and O09 binary-in unsupported |
| `error-channel-review:unsupported-await` | 1 | unsupported | O07 channel qualification and O09 binary-in unsupported |
| `set-iteration-review:eager-values-control` | 1 | PASS | Retained passing control; no new actionable defect |
| `from-entries-alias-review:FE02` | 1 | FAIL | OBJ-001; direct source pair arrays isolate fromEntries alias loss |
| `from-entries-alias-review:FE03` | 1 | FAIL | OBJ-001; direct source pair arrays isolate fromEntries alias loss |
| `from-entries-alias-review:FE04` | 1 | FAIL | OBJ-001; direct source pair arrays isolate fromEntries alias loss |
| `keyword-method-review:method-close` | 1 | PASS | Retained passing control; no new actionable defect |
| `keyword-method-review:method-async-name` | 1 | PASS | Retained passing control; no new actionable defect |

## Current-main static deltas and receipt discipline

Only bounded current-main docs/source were inspected to establish the queue. README:135, README:249-260 and `packages/safejs/src/templates/skill/SKILL_safejs.md:80-89` now describe broader lint support (nested top-level await, switch and sandbox constructors) than historical audit text; this affects HI-001, LINT-01 and editor original expectations. README:274 now describes next-yield dump timing, relevant to AR-002. README:330 and template:111 still carry broad suspended-generator wording, relevant to AR-003. README:265-268 still lists resolved run result shapes without a complete rejection-channel distinction. These are static documentary observations, not current runtime reproduction or proof any ranked issue is fixed. No installed external skill was read or changed.

The original ownership boundaries remain distinct. MC-003 author and independent validation are READY, and full publisher gates on external `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b` pass with unchanged tests/hooks under `env -u TERM`. MC-003 is now published as 11.0.2 at a962264d (Release 33233885143 / Pages 33233885191); MC-001 is published as 11.0.3 at b7dfa471; STR-03 is published as 11.0.4 at 33c73a21; COLL-001 is the current candidate awaiting gates and publication. The serial approved queue is MC-003, MC-001, immutable STR-03, immutable COLL-001, immutable TREE-01, then immutable HI-002; no next issue is integrated before the previous actual successful release and all applicable checks. STR-03 does not fix the remaining STR-01 metadata-offset failure; MC-002 namespace identity remains unresolved. HI-002 retains its author archive-read qualification. All 47 scope rows remain tracked. External npm 11.0.1 is not a remediation release from this lane; actual issue SHA/version/run receipts will be recorded only after observation.

For each future status transition record: issue ID, fix/validator agent, pull/start revision, original case/source path, failing and passing commands/outcomes, validated diff or SHA, issue-plan path, exact committed files, commit/push SHA, required-check run, actual publication/version receipt, and any remaining limits. Keep audit evidence and current evidence in separate fields. A green-but-skipped publication leaves L pending. Do not claim the overall user goal complete from this ledger.

## Inventory-only verification

- Exact 38-path archive exclusion set bootstrapped before master payload reads; whole security directory and outside-cohort provenance directory excluded. No excluded payload probes or recursive out reads.
- Authoritative V12 order reconciled: 21 groups / 23 IDs, 7 P1 / 13 P2 / 1 P3, 13 express / 7 derived / 1 compatibility-only. Two unranked candidates, three historical rows and 21 other rows are explicit.
- Static in-memory mapping covers all 128 functional FAIL and 17 unresolved case rows, with original case IDs/entry paths and preserved qualifications; no otherwise-unmapped failure is silently dropped. All 30 review-only rows map to a group/disposition.
- Only this master plan is written by this ledger owner; this owner performs no implementation/runtime/test campaign, README edit, branch, Git mutation, audit copy or security work. The original audit and original worktree files remain unchanged; the coordinator-reported aborted pull did fetch original-repository refs/tags without merging. Authorized remediation workers may execute functional reproductions and independent validation.
- Active worker assignments and serial publication preparation are relayed handoff facts, not independently executed or observed results by this ledger owner. The freshly pulled clean-clone state, dependency readiness and npm `11.0.0` publication baseline were reported by the coordinator/setup worker, not supplied as user observations. This status-only update does not reopen or alter the census.
