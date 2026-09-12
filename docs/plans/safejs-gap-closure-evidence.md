# SafeJS gap-closure evidence

## Authoritative commit receipt — 2026-09-12

This section and the three maintained attachments below are the self-contained baseline deliverable. The earlier inspection and audit narrative is preserved below as history; optional raw artifacts and uncommitted documents are identified as plain-code local historical references, not required committed dependencies. Earlier “none committed”, release-hold, “current release”, and completion statements belong to their stated observation times.

- [Complete category-to-task map and current known-gap census](safejs-gap-closure-categories.md): **1,474 stable IDs**, comprising 199 Test262 features, 270 path categories (**128 directories and 142 immediate file paths**), 955 historical evidence records, 11 exploratory files and 39 explicit current cases. This corrects earlier “270 directory” terminology without dropping any path. Each row has a primary owner, disposition, clause/path or contract, and inherited required runtime/reproduction/regression/original-replay/artifact/release gates.
- [Exact target, runtime matrix and release receipts](safejs-baseline-commit-target.md): immutable published ECMA-262 edition 16 / June 2025 and ECMA-402 edition 12 / June 2025; Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`; separately pinned Temporal, upsert and Atomics.pause contracts. Required cells preserve Node **18.18.0** minimum, Node 18/20 legacy controls, CI22, current Node24/26, Bun and Workerd. Missing runtime execution remains unverified.
- [Exact maintained commands, terminal results and reproductions](safejs-baseline-commit-checks/check-results.md): same-source full baseline receipts independently revalidated by 24 hashes, plus fresh ISO/Promise/conformance probes. Source `d126d355c150a076e6c5d5f110162289c57ed1c9`, Node **22.23.2**, ICU **78.2**. No source, assertion, budget, timeout or runtime support changed.

**Baseline outcome:** maintained SafeJS tests **failed** with 29,013 passing, seven failing and 47 skipped assertions. All seven failures are untracked exploratory ISO/Promise assertions; the same command's tracked partition has 28,904 passes, zero failures and 47 skips. These are partitions of one invocation, not a separate passing tracked-only run. The maintained SafeJS build closure and repository lint **passed**. Fresh focused ISO/Promise reproduction again has 13 passes/seven failures; selected Test262 has 32 passes/three unsupported variants; the separate Temporal selection has six failed variants. No skip, unsupported mode or recorder completion is a semantic pass. The current tracked public-input timing check passes unchanged; its prior timeout remains a historical reliability lead.

**Initial dispositions:** missing ISO month fields reproduce with native backend agreement on Node20/CI22 and remain an upstream/backend limitation with normative locale qualification open; native Promise symbol omission is an explicit host-admission boundary and requested capability gap, not an ECMAScript cloning defect. The minimum valid Temporal date RangeError violates the separately pinned Temporal extension contract. Module/blocking cases expose verified runner exclusions; they do not authorize ambient imports or blocking the host. The map separately retains accessor/species hooks, weak minimum-runtime/finalization, shared-memory recovery, Temporal portability, live-realm admission, native iterator state, host effects and four distinct timing leads.

**Acceptance:** the target is finite, the full feature/path census is reviewable, and current known gaps from the README's host-copy/meaningful-limitations sections, September 8/10 checkpoint unresolved sections and all 11 exploratory files are assigned explicit cases or named category owners. Historical records remain individually owned and unverified until qualified; inventory is not an assertion that all historical claims remain true, were repaired, or passed. Full corpus execution, fixture-to-edition reconciliation, all runtime/replay cells and compatibility closure remain future task gates. No untracked test is adopted as shipped regression coverage.

**Independent documentation QA:** a fresh parsed-YAML census reconciled all 199 feature counts/path digests and all 270 path counts with zero mismatches; 53,876 JS files, 294 fixture/header exceptions, 18,651 valid untagged headers, zero YAML parse failures. The map records two preliminary census setup errors separately. Manual review checks ownership, Gate G inheritance, exact source/runtime/command outcomes, host authority, proposal separation and release attribution; mechanical review checks table shape, unique IDs, fences and required links. Final independent review passed `npx prettier --check` for these four files, reconciled all 1,474 unique IDs to 33 primary task owners, and found zero table-width, fence or required relative-link errors; every required relative target is tracked or in this four-file commit set. An initial reviewer matcher omitted the annotated C-PROPOSALS coordination row; correcting the matcher yielded 39 cases without changing the inventory. Only the four linked evidence documents are task-owned commit paths. Existing staged Safe Bash work and all unrelated local files remain untouched. Documentation-only work requires no visual CLI screenshot or repair TDD cycle.

**Delivery distinction:** the fresh target receipt observes newer remote main `16fd655592118dbac4cf6764b8a2f3c8f6138786` and published SafeJS **0.1.560**, distinct from tested local source and the specifically probed **0.1.559** artifact. Registry success does not qualify either the ledger or new artifact behavior. The target receipt owns exact umbrella/scoped workflow timestamps and conclusions. This evidence commit is local only; no push or publication of this ledger is authorized or claimed. The resulting local SHA is reported after commit.

## Preserved historical evidence

**Canonical target:** ECMA-262 edition 16 (June 2025), ECMA-402 edition 12 (June 2025), and Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, with separately pinned newer APIs. Start with the [baseline execution](#establish-baseline-execution--2026-09-11), category-to-task map (local historical evidence: `docs/plans/safejs-baseline-20260911/category-inventory.md`), and [current revalidation](#establish-baseline-revalidation), including the [new tracked timing case](#additional-initial-failure-public-input-qualification-timing).

**Latest audit:** [final candidate audit](#final-candidate-audit--2026-09-12) separately records this execution's checks and preservation receipts. Earlier completed runs below remain historical evidence, not results of that audit.

**Evidence chronology:** the original inspection and its later execution receipts below predate this revalidation and remain preserved. Statements such as “no tests ran” or “gates remain outstanding” apply to the inspection that made them. Previously recorded test and publication results remain attributed to their original commands, source revisions and runtimes; they are not new executions by this revalidation.

Inspection recorded 2026-09-11, approximately 23:41–23:44 UTC. This is the evidence companion to [the language-completeness draft](safejs-language-completeness.md), not another runnable pipeline.

## Authorization and evidence boundary

This turn inspected repository instructions, local and remote main, pipeline definitions, task statuses, existing evidence, and existing release metadata. Creating this record does not run the plan or authorize an immediate release. No runtime tests, conformance probes, lint, build, pipeline execution, task-state mutations, commits, pushes, or publications were performed. All task acceptance gates remain outstanding for this draft. The existing successful releases below are observations of prior delivery, not delivery performed by this turn or evidence that every draft task is complete.

During later authorized execution, follow each task's selected steps and release gates. Do not impose an inherited blanket release hold or treat old checkmarks as proof. Do not modify unrelated changes or staged drafts. The draft's README-authorization sentence is recorded task text, not an independent permission grant from this inspection; README edits remain outside this turn's scope.

## Applicable instructions

- [/Users/kjopek/Workspace/AGENTS.md](/Users/kjopek/Workspace/AGENTS.md): root delegates substantive investigation, implementation, and verification to subagents. This inspection was delegated accordingly.
- [Repository AGENTS.md](../../AGENTS.md): preserve others' changes; validate reported defects before repairs; TDD for code; work on main; use selective maintained checks or full gates for broad changes; explicit task-owned staging; separate local, remote, and publication evidence; monitor required releases after an authorized push; planning lives in docs/plans.
- No AGENTS.md exists between repository root and this file. The discovered packages/safe-bash/AGENTS.md and deeper fixture instructions do not govern this documentation-only change. Reinspect applicable package instructions before future implementation.
- Publishing instructions referenced by AGENTS.md are actually at [docs/development/NPM_PUBLISHING.md](../development/NPM_PUBLISHING.md). This work permits no local publication.

The pipeline-plan skill was read to interpret the existing YAML frontmatter and selected statuses. It does not require creating a second pipeline or running one. The companion has no executable frontmatter.

## Revision and preservation snapshot

| Item                                             | Observed value                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| Local branch                                     | main                                                                  |
| Local HEAD                                       | d126d355c150a076e6c5d5f110162289c57ed1c9                              |
| Local HEAD subject                               | test(safe-js): qualify month-day timezone oracle                      |
| Cached origin/main                               | 4af337d98df423642869a313eefa74e09a87c53e                              |
| Actual remote main, read twice with ls-remote    | 79999cba7bb7bae0581a7a1ba035c4abed6f0397                              |
| Remote tip timestamp and subject                 | 2026-09-11T21:26:36Z; chore(release): retain concurrent main delivery |
| GitHub comparison, local HEAD to observed remote | ahead_by 11, behind_by 0; merge base equals local HEAD                |
| Inspection runtime                               | Node v22.23.2, ICU 78.2, Unicode 17.0; darwin arm64                   |
| Pre-existing porcelain status entries            | 60; includes one untracked directory entry                            |
| Staged binary diff SHA-256                       | 839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8      |
| Working pipeline steps SHA-256                   | 200d2f170cfed972b2dc487def8d8e5882e0b9e77c3bfaef297e3a83c25e0f0e      |
| Working language plan SHA-256                    | 5e459e80f0404fd761fbe22887523106bc3a5c7b1c312a230ec40c365bd035b6      |

Remote main was inspected through GitHub APIs because its tip object was not present locally. No fetch, checkout, reset, pull, rebase, or ref update was needed. The cached origin/main is stale and is not the current remote baseline. Source-only local results cannot qualify the later remote changes: among the eleven commits are SafeJS execution pause/resume, completed-run continuations, completed-replay fixture cost reduction, and earlier rejection of invalid snapshot scalars.

Three pre-existing staged files must remain staged and unchanged:

- packages/safe-bash/src/commands/text.ts
- packages/safe-bash/tests/commands/helpers.ts
- packages/safe-bash/tests/commands/text.test.ts

The original staged diff is 33 insertions and 3 deletions across those files. Existing unstaged changes include project pipeline steps, both READMEs, the language plan and other SafeJS plans; exploratory SafeJS tests and many other plans are untracked. These are inputs to inspection, not task-owned deliverables. A before/after binary index diff hash and status/file fingerprints were captured for preservation checks; the temporary inspection baseline is /tmp/poe-gap-evidence-preservation.json and is not a durable test artifact. No existing file is adopted, staged, or repaired by this record.

## Pipeline and task status

The effective project file is [.poe-code/pipeline/steps.yaml](../../.poe-code/pipeline/steps.yaml), which takes precedence over a home default. Its working copy defines reproduce → implement → refactor → test → commit → release, plus evidence-auditing teardown. The working language plan is kind: pipeline, version: 1, readiness: draft. Its setup prompt is exactly the instruction that triggered this inspection. No finalization or setup-completion state was added.

Both files are pre-existing unstaged drafts. At local HEAD and the observed remote tip, steps contain only implement, refactor, test, commit, release; commit/teardown say to commit all changes. The remote language document remains the historical checklist and has no pipeline frontmatter. Those historical broad commit prompts do not override preservation instructions. A clean remote checkout therefore does not contain this draft's reproduce step or task inventory; a future executor must use an explicitly reconciled plan/steps pair and recheck status rather than assuming the draft has shipped.

The schema [docs/schemas/plans/pipeline.schema.json](../schemas/plans/pipeline.schema.json) allows per-step status maps. Parsing the current draft with the installed YAML parser found 33 unique task IDs, all selected statuses open, and every selected step present in working project steps. Missing steps below are intentionally unselected, not done. No task was marked complete on the strength of inspection.

| Task ID                              | Selected steps, in order                              | Recorded status |
| ------------------------------------ | ----------------------------------------------------- | --------------- |
| establish-baseline                   | reproduce, implement, test, commit, release           | All open        |
| complete-conformance-runner          | reproduce, implement, refactor, test, commit, release | All open        |
| verify-conformance-oracles           | reproduce, implement, refactor, test, commit, release | All open        |
| repair-iso-month-formatting          | reproduce, implement, refactor, test, commit, release | All open        |
| repair-temporal-extremes             | reproduce, implement, refactor, test, commit, release | All open        |
| repair-promise-symbol-admission      | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-source-modules               | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-module-authority             | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-lexical-and-source-text      | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-async-job-order              | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-error-completions            | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-language-semantics           | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-exotic-object-invariants     | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-binary-memory                | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-regexp-semantics-and-cost    | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-builtins                     | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-intl-environment-matrix      | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-weak-lifetimes               | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-shared-memory                | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-realms-and-recovery          | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-snapshot-adversarial-input   | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-lifecycle-and-retention      | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-resource-and-timing-behavior | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-generated-interactions       | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-environment-contract         | reproduce, implement, refactor, test, commit, release | All open        |
| qualify-public-api-and-diagnostics   | reproduce, implement, refactor, test, commit, release | All open        |
| drain-conformance-findings           | reproduce, implement, refactor, test, commit, release | All open        |
| verify-runtime-support-matrix        | reproduce, implement, refactor, test, commit, release | All open        |
| verify-integrated-candidate          | reproduce, implement, refactor, test, commit, release | All open        |
| verify-package-provenance            | reproduce, implement, refactor, test, commit, release | All open        |
| publish-compatibility-documentation  | implement, refactor, commit, release                  | All open        |
| prepare-release-failure-recovery     | reproduce, implement, refactor, test, commit, release | All open        |
| verify-final-release                 | implement, test, commit, release                      | All open        |

## Existing releases: fresh read-only observations

At inspection time, [Release run 34649408167](https://github.com/poe-platform/poe-code/actions/runs/34649408167) and [scoped safe run 34649407953](https://github.com/poe-platform/poe-code/actions/runs/34649407953) both completed successfully at remote SHA 79999cba7bb7bae0581a7a1ba035c4abed6f0397. The scoped run's installed-tarball and all three publish steps report success. An older root run at 31fe11c1f was cancelled; it is not the current result.

| Registry package        | Observed latest version | Association evidence                                                                                        |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| poe-code                | 15.0.24                 | npm gitHead equals observed remote SHA                                                                      |
| @poe-platform/safe-js   | 0.1.559                 | Registry SLSA provenance payload names observed remote SHA, release-safe.yml, and run 34649407953 attempt 1 |
| @poe-platform/safe-fs   | 0.1.559                 | Registry version and successful scoped publish step; individual provenance not inspected                    |
| @poe-platform/safe-bash | 0.1.559                 | Registry version and successful scoped publish step; individual provenance not inspected                    |

SafeJS registry integrity was sha512-R3gJgcAT2A59ayHnZEnx8wVThed9Tz9AWo2wZRteX5hsroXyqqjvHZb7l/AEfn1YqAeFfe1AqMU3q5j/KyIC8g==. Its [registry attestation](https://registry.npmjs.org/-/npm/v1/attestations/@poe-platform%2fsafe-js@0.1.559) was decoded and inspected, not independently signature-verified. No artifact was downloaded, installed, or tested in this turn. Individual filesystem/bash provenance and fresh installed-artifact QA remain future gates.

The private workspace name @poe-code/safe-js is not the public registry name: a read-only lookup returned E404. The actual scoped publish names come from release-safe.yml and publishing documentation. Do not interpret the private workspace's version 0.0.1 or private: true as the public release state. Do not infer completeness from registry versions or successful workflows.

## Initial evidence disposition and next authorized work

No defect is newly reproduced here. The following entries are leads with primary task owners; a complete Test262 category manifest and exact standards pin must be produced by establish-baseline during authorized execution.

| Lead / category                                  | Current inspection evidence                                                                                                        | Primary owner and required next evidence                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target specification and corpus census           | Corpus source pins 419d3e0a2273ba01a3bfcbec423f2801425b8e93; no exact published ECMAScript edition is pinned by this inspection    | establish-baseline: pin the published edition and clause/category map; track newer APIs separately                                                                        |
| Runner and oracle accounting                     | Maintained command and corpus source exist; this turn did not execute them                                                         | complete-conformance-runner and verify-conformance-oracles: enumerate all upstream variants and account for positives, negatives, async, exclusions and truncated results |
| ISO-calendar missing months                      | Untracked iso-month-name-completeness.test.ts; current dirty README and dated inventory report failures                            | repair-iso-month-formatting: reproduce exact current candidate with calendar/locale/width controls and runtime metadata                                                   |
| Temporal extremes and host zones                 | Existing temporal-intl-extreme-range plan and untracked Temporal probes                                                            | repair-temporal-extremes: validate endpoint/zone/backend distinctions across required cells                                                                               |
| Native Promise user symbols                      | Untracked promise-import-properties.test.ts and native-promise-symbol-boundary plan                                                | repair-promise-symbol-admission: establish safe admission and independent active/retired-context isolation controls                                                       |
| Runtime support                                  | Root engines.node is >=18.18; CI release uses Node 22; package exports include workerd paths and scoped release smoke includes Bun | verify-runtime-support-matrix: verify exact minimum Node 18.18.0, CI version and advertised supported cells/entrypoints, with per-cell availability and outcome           |
| Timing and retained-state reliability            | Historical camera/string-split/replay reports; remote has newer replay/snapshot commits                                            | qualify-resource-and-timing-behavior: repeat original limits on the exact candidate; separate deterministic correctness from bounded performance evidence                 |
| Module/agent/environment limits                  | Dirty README distinguishes registered host modules and Script-only runner support from ambient host APIs                           | qualify-source-modules, qualify-shared-memory, qualify-environment-contract: reproduce current semantics and map required modes and intentional grants explicitly         |
| Remaining language/built-in/transport categories | Broad task coverage exists, but no executed category census was produced here                                                      | establish-baseline assigns each category one owner from the task inventory; track cross-task dependencies and no unowned exclusions                                       |

The [September 10 inventory](safejs-current-gap-inventory-2026-09-10.md) contains layered historical assertions: for example, 28,864 passes, 13 failures and 47 skips at 0c71c7aa4, plus references to temporary reports and subsequent changes. It also retains older live-run and release-hold text. These are historical leads, not fresh results for local HEAD or remote main. Report artifacts were not revalidated here. The fresh remote/registry observations disprove a blanket current local-only/unreleased conclusion; they do not prove individual historical failures were repaired. Untracked tests are neither shipped regressions nor established current failures merely because they exist.

## Reproduction commands for this inspection

Run these read-only commands from the repository root; remote values may move, so record timestamp and keep comparison SHAs fixed. Parse YAML with the installed parser, not textual rewriting. These commands inspect state; none starts a pipeline or changes task status.

```sh
date -u '+%Y-%m-%dT%H:%M:%SZ'
git status --porcelain=v1
git diff --cached --stat
git rev-parse HEAD origin/main
git ls-remote origin refs/heads/main
gh api repos/poe-platform/poe-code/compare/d126d355c150a076e6c5d5f110162289c57ed1c9...79999cba7bb7bae0581a7a1ba035c4abed6f0397 --jq '{status,ahead_by,behind_by,merge_base:.merge_base_commit.sha}'
gh api 'repos/poe-platform/poe-code/contents/.poe-code/pipeline/steps.yaml?ref=79999cba7bb7bae0581a7a1ba035c4abed6f0397'
gh api 'repos/poe-platform/poe-code/contents/docs/plans/safejs-language-completeness.md?ref=79999cba7bb7bae0581a7a1ba035c4abed6f0397'
gh run view 34649408167 --json headSha,status,conclusion,jobs
gh run view 34649407953 --json headSha,status,conclusion,jobs
npm view poe-code@15.0.24 version gitHead --json
npm view @poe-platform/safe-js@0.1.559 version gitHead dist.integrity dist.attestations --json
npm view @poe-platform/safe-fs@0.1.559 version gitHead --json
npm view @poe-platform/safe-bash@0.1.559 version gitHead --json
```

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import YAML from 'yaml';
const raw = fs.readFileSync('docs/plans/safejs-language-completeness.md', 'utf8');
const plan = YAML.parse(raw.split('---')[1]);
const steps = YAML.parse(fs.readFileSync('.poe-code/pipeline/steps.yaml', 'utf8')).steps;
console.log({ readiness: plan.readiness, tasks: plan.tasks.length });
for (const task of plan.tasks) {
  console.log(task.id, task.status);
  for (const step of Object.keys(task.status)) {
    if (!(step in steps)) throw Error('Unconfigured step: ' + step);
  }
}
console.log('stagedDiffSha256', crypto.createHash('sha256').update(
  cp.execFileSync('git', ['diff', '--cached', '--binary'])).digest('hex'));
console.log({node: process.version, icu: process.versions.icu,
  unicode: process.versions.unicode, platform: process.platform, arch: process.arch});
NODE
```

## Gates for later authorized execution

1. Refresh instructions, source SHAs, dirty/index fingerprints, effective steps and task statuses. Reconcile concurrent remote changes without discarding local drafts. Pin standard edition, Test262 revision, environment and category inventory before claiming baseline acceptance.
2. For each reported defect, record a minimal failing regression and neighboring passing control before runtime edits. Classify defect, unverified behavior, intentional boundary and upstream limitation separately. A native engine is a control; primary specification clauses determine expected behavior. Unit fixtures use memfs and mocked capabilities.
3. Record exact commands, exit codes, timestamps, candidate fingerprints, Node/ICU/TZ/locale, budgets and fixture hashes. For each case include owner, standard clause/Test262 path, expected/actual behavior, failure phase, runtime cells, original/pending/completed replay outcomes, regression and artifact probe. Preserve failures, unsupported modes, skips, timeouts and incomplete runs distinctly; no unavailable cell is a pass.
4. Use maintained routes: focused package checks when justified; npm test, npm run lint and npm run build for broad/shared or final integration changes. Package test scripts include native pre/post hooks. Use npm run build:workspaces -- --workspace=@poe-code/safe-js only for the explicitly selected build closure. Use npm run lint:workflows for workflow edits. Derive unit membership from maintained declarations; respect AGENTS.md hook/environment isolation. Do not execute these gates merely because this document lists them.
5. The existing conformance entrypoint is npm run test:conformance --workspace=@poe-code/safe-js -- --corpus <clean-pinned-checkout> --report <new-report.jsonl>. Selectors and limits require explicit recording. Preserve all variants and a final summary; selected probes are not full-corpus qualification. Execute QA from Markdown, and inspect screenshots for CLI-visible changes.
6. After required checks pass for the exact candidate, make separate Conventional Commits for atomic task-owned improvements and their evidence, preserving unrelated staged content. Work on main unless separately requested. Do not bypass hooks. Record local commit SHA independently of delivery.
7. At each authorized task release step, fetch/reconcile safely, revalidate affected changes, push normally and verify remote ancestry. Close only explicitly associated validated issues once their fixes are verified on remote main. Monitor required root and scoped workflows through publication; follow cancelled/superseded runs only after proving successor ancestry. Confirm every affected package separately, its registry version/integrity/provenance and fresh installed-artifact smoke. A documented docs/config no-release outcome is not a publication claim.
8. Leave unresolved publication failures open with a concrete forward-recovery path. Never force-push, bypass hooks, publish locally, unpublish or destructively roll back. Continue independent work while releases run only where the runner permits it. Final completeness requires all required category/runtime gates, final exact-candidate integration and actual release receipts; successful historical release alone does not satisfy these gates.

## Per-case and delivery receipt template

For each future case append: case ID; primary owner/dependencies; category/clause/upstream path and revision; disposition; source SHA plus dirty fingerprint; runtime/ICU/locale/TZ and package import family; minimal reproduction/control; command and elapsed time; expected/actual outcome and phase; original/replay cells; pass/fail/skip/unsupported totals and terminal-report hash; fix/regression paths; remaining blockers. Separately append local SHA, verified remote ancestry, workflow URL/conclusion, package/version/integrity/provenance, installed-artifact result and publication timestamp. Do not replace an earlier receipt with a later undated completeness checkmark.

## Inspection verification

Documentation-only checks passed: 33 unique task IDs and their exact selected open statuses match the parsed draft; all referenced local Markdown targets exist; fenced commands are balanced; this companion has no runnable frontmatter. All 60 original porcelain entries and 59 pre-existing file fingerprints remain unchanged. The staged binary diff still hashes to 839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8. The only additional status entry is this untracked evidence file. These preservation/structure checks are not runtime qualification or task acceptance results.

## Establish-baseline execution — 2026-09-11

This section records the subsequently authorized `establish-baseline` task. The preceding inspection is preserved as historical evidence: its statements that no tests ran, gates remain future, or execution was unauthorized describe that earlier inspection only. This section and its linked receipts are the canonical initial baseline. No runtime repair, README edit, task-status mutation, commit, push or publication was performed. Existing failing assertions, budgets, runtime support and timeouts were preserved.

### Fixed compatibility target

The target is **ECMA-262, 16th edition, June 2025 (ECMAScript 2025)**, with **ECMA-402, 12th edition, June 2025** for the exposed Intl contract. These are exact published editions, deliberately not a floating latest draft: [ECMA-262 edition 16](https://262.ecma-international.org/16.0/) and [ECMA-402 edition 12](https://402.ecma-international.org/12.0/). Official document hashes and primary clauses are retained in target receipts (local historical evidence: `docs/plans/safejs-baseline-20260911/target-receipts.md`).

Test262 is pinned to **`419d3e0a2273ba01a3bfcbec423f2801425b8e93`**. Its newer fixture inventory does not expand the edition target. Temporal is separately tracked against proposal revision **`e8cc03fc970a65a3359e8870e3b35e687ac94e55`**; Map/WeakMap upsert uses **`351528e4a6f47c557d141b8086fa4b9391cbef03`**, and newer Atomics.pause uses the clause in ECMA-262 source **`b7865f0eed2021720f84d561289401bc414874d0`**. Immutable extension receipts (local historical evidence: `docs/plans/safejs-baseline-20260911/extension-spec-pins.json`) retain source URLs and hashes. These are separate extension categories. Existing WeakMap, WeakSet, WeakRef, FinalizationRegistry and base Atomics semantics remain in the edition target. Proposal/staging tests, host harness facilities and unresolved edition membership remain visible, without counting them as edition conformance or silently discarding their coverage.

This is a finite compatibility target, not a declaration that SafeJS implements every clause. ECMA-262 Script/module semantics and the registered-module host contract must be qualified separately. Ambient filesystem/npm imports, host process access, arbitrary live host objects, deterministic GC and unrestricted blocking authority are not granted by naming ECMAScript as a target. Every admitted host capability retains explicit ownership and authority.

### Canonical inventory and ownership

The following attachments are constituent tables and raw receipts of this ledger, not competing plans:

| Evidence                                                                                                                        | Coverage                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category-to-task map and current cases (local historical evidence: `docs/plans/safejs-baseline-20260911/category-inventory.md`) | Every one of 199 declared-or-observed Test262 features; complete test-directory categories including untagged sources; 955 historical SafeJS Markdown records; all 11 untracked exploratory files; stable IDs, primary task owners and cross-feature dependencies |
| Inventory manifest (local historical evidence: `docs/plans/safejs-baseline-20260911/inventory-manifest.json`)                   | Exact fixture counts, path-list and content hashes, feature/header exceptions and historical-record fingerprints                                                                                                                                                  |
| Check receipts (local historical evidence: `docs/plans/safejs-baseline-20260911/check-results.md`)                              | Maintained commands, source revisions, local/fresh-remote focused reproductions, stdout/stderr links, passing controls and setup failures                                                                                                                         |
| Target, runtime and release receipts (local historical evidence: `docs/plans/safejs-baseline-20260911/target-receipts.md`)      | Primary specification text, runtime contracts, immutable publication identities, native and installed-artifact probes, preservation evidence                                                                                                                      |

The corpus contains **53,876 JavaScript files**. Feature counts overlap and are not pass totals. The 294 missing metadata headers are suffix-named fixture files; they are recorded inventory exceptions, not 294 runner failures. Files lacking feature tags remain covered by directory rows. A feature's sample path is a metadata association, not necessarily its smallest semantic reproducer.

Each unresolved row has exactly one primary task owner. The row inherits Gate G from the category map: exact clause or pinned path, required runtime cells, smallest counterexample and passing control, fast failing maintained regression before repair, original/pending/completed replay checks, installed-artifact probe and feature-level release receipt. Common dependencies include runner completeness, oracle verification, recovery, runtime support and package provenance. A dependency finishing does not remove the primary owner's coverage obligation. Historical claims remain `unverified` unless linked to a fresh receipt; listing a historical repair does not mark it repaired on the present candidate.

Disposition vocabulary is fixed: **defect** means reproduced violation of a pinned standard or applicable public contract; **unverified** means missing or stale evidence; **intentional boundary** means deliberately withheld host capability or documented admission behavior; **upstream limitation** identifies a reproduced backend restriction without absolving guest contract obligations; **verified** is bounded success at an exact revision/runtime; **delivered** requires verified remote-main ancestry; **published** requires version/provenance/workflow and artifact receipts. These labels apply per case and evidence scope; a published package is not proof that an unresolved category is verified.

### Revision and runtime matrix

Local maintained checks use source **`d126d355c150a076e6c5d5f110162289c57ed1c9`**, Node **22.23.2**, ICU **78.2**, CLDR **48.0**, V8 **12.4.254.21-node.56**, Darwin arm64. Fresh remote main is **`79999cba7bb7bae0581a7a1ba035c4abed6f0397`**, eleven commits ahead, including SafeJS execution/replay changes. Cached `origin/main` is stale. Local results do not certify the newer full tree. An isolated exact-remote snapshot independently reproduces the ISO and Promise failures; no checkout or ref was replaced.

| Cell    | Exact runtime / ICU when measured | Required role and observed coverage                                                                                       |
| ------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| MIN     | Node 18.18.0 / 73.2               | Actual manifest/bundler minimum; published artifact import, arithmetic, guest Promise symbol and ISO controls executed    |
| N18     | Node 18.20.8 / 74.2               | Legacy contract control available; this task did not execute full qualification                                           |
| N20     | Node 20.20.2 / 78.2               | Legacy contract control available; this task did not execute full qualification                                           |
| CI22    | Node 22.23.2 / 78.2               | Workflow major 22; local maintained checks, focused current-remote probes, selected Test262 and published artifact probes |
| N24     | Node 24.21.0 / 78.3               | Current supported LTS; published artifact bounded probes executed                                                         |
| N26     | Node 26.8.2 / 78.3                | Current supported Current; published artifact bounded probes executed                                                     |
| BUN     | Bun 1.3.11                        | Published workflow includes Node/Bun smoke; fresh local category probes unexecuted                                        |
| WORKERD | workerd 2026-09-01                | Public conditional export/platform; fresh category probes unexecuted                                                      |

The `node >=18.18` contract is not raised because upstream Node 18/20 are EOL. Other admitted odd and historical versions have missing coverage explicitly assigned to `verify-runtime-support-matrix`; this representative matrix is not permission to remove their support. Full runtime suites, replay and platform-specific capabilities remain unverified even when bounded artifact smoke passes.

### Initial failure and exclusion ledger

| Case / primary owner                                 | Fresh reproduction and neighboring control                                                                                                                                                                                                                                | Disposition and remaining acceptance                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-ISO / `repair-iso-month-formatting`                | Local and fresh remote exploratory files: six long standalone/range failures in en-US/pl-PL/ru-RU; 12 other-width controls pass. Node 22.23.2 native, built local and published 0.1.559 return missing month parts; installed artifact on MIN/N24/N26 returns names.      | Upstream/backend limitation exposed through guest Intl/Temporal; normative pattern-selection qualification remains open. Preserve ISO calendar, grammatical context, parts/range attribution and replay. Exact locale names are not universal ECMA-402 assertions.                                                                                                   |
| C-PROMISE-SYMBOL / `repair-promise-symbol-admission` | Native Promise own `Symbol('label')` value 42 becomes undefined on import; own string descriptor passes. Same local/current remote result. Published artifact omits native symbols on all four tested Node cells, while guest-created Promise symbols return `[42,true]`. | Intentional current admission boundary and requested capability gap, not an ECMA-262 cloning defect. Published README explicitly documents omission/private-context isolation. Any future admission must preserve active/retired host context isolation; symbol descriptions cannot establish ownership. Original import reproduced; replay acceptance remains open. |
| C-TEMPORAL-EXTREME / `repair-temporal-extremes`      | Three pinned `intl402/DateTimeFormat/prototype/format/temporal-objects-no-time-clip*.js` fixtures produce six failing variants locally. Minimum PlainDate `-271821-04-19` raises RangeError; ordinary date and maximum date controls pass.                                | Reproduced newer-API failure; backend attribution, current-remote and full runtime/replay coverage remain unverified. Use pinned Temporal HandleDateTimeTemporalDate contract; no TimeClip clamping.                                                                                                                                                                 |
| C-MODULE / `qualify-source-modules`                  | `language/module-code/early-dup-export-dflt.js`: one unsupported module variant; neighboring Array.of Script selection passes.                                                                                                                                            | Verified runner exclusion; language semantics unverified. Registered-module authority boundary is separate. Complete runner and opt-in host resolution without ambient imports.                                                                                                                                                                                      |
| C-BLOCKING / `qualify-shared-memory`                 | `built-ins/Atomics/wait/cannot-suspend-throws.js`: two unsupported variants because runner rejects `CanBlockIsFalse`.                                                                                                                                                     | Verified runner exclusion, not demonstrated semantic failure. A nonblocking TypeError case must not require granting blocking authority.                                                                                                                                                                                                                             |
| C-OTHER-EXPLORATORY / individual owners in map       | Other nine untracked files: 96 passed, zero failed/skipped. Combined exploratory files: 109 passed, seven failed.                                                                                                                                                         | Verified bounded local observations only; not shipped regression coverage or complete weak/Temporal/proxy qualification.                                                                                                                                                                                                                                             |
| C-FULL-CORPUS / `complete-conformance-runner`        | Selected control report: 18 files, 35 variants, 32 passes, zero failures, three unsupported; separate Temporal selection: three files, six failed variants. Both commands exit 1.                                                                                         | Explicit initial exclusions and failures; no full-corpus pass claim. Counts from selections must not be added to feature-tag file counts.                                                                                                                                                                                                                            |
| C-HISTORICAL / owners in map                         | All prior holds, failures, fixes, weak minimum-runtime leads, recovery and timing reports retain record IDs/hashes.                                                                                                                                                       | Unverified until rechecked at exact source/runtime. Fresh successful releases supersede old release-status claims, not feature failures.                                                                                                                                                                                                                             |

Small executable counterexamples, precise commands, source/fixture hashes and raw reports are linked in the check and category receipts. No failing test was removed or weakened. No fix was invented for a nonreproducing report. This baseline has made no runtime changes, so TDD repair cycles remain assigned to their primary repair owners.

### Maintained checks and acceptance record

The selected maintained workspace build closure passed, including seven SafeJS built-import checks. Repository `npm run lint` passed its ESLint, type-contract and workflow stages. The maintained `npm test --workspace=@poe-code/safe-js` completed with **exit 1**: **29,013 passed, seven failed, 47 skipped**, 29,067 tests total; **1,309 passed, two failed, two skipped files**, 1,313 files total. Vitest duration was **1,744.78 seconds**. The package command includes native pretest and all discovered local exploratory files; those files must not be presented as shipped tests. All seven failures are the six ISO and one Promise-symbol exploratory assertions. The remote focused run's initial missing-generated-data setup failure is retained separately from its prepared 7-failure/13-pass result.

The tracked subset accounts for **28,904 passed, zero failed, 47 skipped tests** across **1,300 passed and two skipped files**. The untracked exploratory subset accounts for **109 passed, seven failed, zero skipped tests** across **nine passed and two failed files**. These are partitions of the completed maintained command, not a second tracked-only run. Skips retain their native/optional environment guards in the check receipt; unavailable cases are not passes. The selected Temporal conformance failures are a separate probe and must not be folded into package-unit totals.

Baseline acceptance is evidenced: the published edition and upstream revisions are fixed; every inventoried category and historical lead has an owner and disposition; the initial failures/exclusions are explicit; maintained tests, lint, build and selected probes have terminal receipts. **This establishes the baseline, not compatibility closure.** Full-corpus execution, fixture-to-edition reconciliation, unexecuted runtime/replay cells, ISO backend handling, safe user-symbol admission and Temporal extremes remain open with the primary owners in the category map. No blanket release hold is imposed by those baseline findings.

No screenshot is required for a documentation-only ledger with no CLI-visible change. Full repository `npm test` was not substituted with root-only unit tests or claimed: this task selected the maintained SafeJS package baseline and its declared build closure. Full integrated candidate and all-runtime conformance gates belong to their named tasks.

The successful ESLint result covers its admitted scope: 11,462 linted files, with 2,041 ignored files, 38,883 unconfigured files, 195 ignored directories and five held boundaries. The exclusion receipt (local historical evidence: `docs/plans/safejs-baseline-20260911/target-receipts.md#explicit-existing-eslint-holds`) lists the existing Safe Bash holds and their pinned policy; their contents were not lint-validated and this task did not change those exclusions.

### Delivery and publication receipts

Fresh read-only receipts confirm **remote main `79999cba7bb7bae0581a7a1ba035c4abed6f0397`** was published as **`@poe-platform/safe-js@0.1.559`** and **`poe-code@15.0.24`**. [Scoped workflow 34649407953](https://github.com/poe-platform/poe-code/actions/runs/34649407953) and [umbrella workflow 34649408167](https://github.com/poe-platform/poe-code/actions/runs/34649408167) succeeded. Registry integrity/provenance and fresh installed-artifact probes are retained in the target receipt. Attestation payloads were inspected, not independently signature-verified.

These are **published baseline receipts**, not publication of this ledger or fixes for its open cases. This task has no local commit, no push and no new release. The prior preservation manifest confirms all 59 original files and the original staged binary diff remained unchanged before this ledger synthesis; task writes are confined to this ledger and its evidence attachments.

Documentation verification is recorded in documentation checks (local historical evidence: `docs/plans/safejs-baseline-20260911/documentation-checks.md`): 199 feature, 955 historical and 11 exploratory rows have unique IDs and valid primary owners; all 966 inventoried source fingerprints match; authored local links resolve. Relative links inside byte-preserved captured upstream/published READMEs are interpreted at their original locations and are explicitly distinguished from authored ledger links.

Final post-gate preservation also passes: receipt (local historical evidence: `docs/plans/safejs-baseline-20260911/preservation-check-final.json`) confirms the 59 original file hashes, source HEAD and staged binary diff are unchanged. The completed package log SHA-256 is `cc9d8b2ef8fa1a325013b144a57dbe1740e6f7b420ffa5228ee3539575bb0ea0`; parsed terminal accounting (local historical evidence: `docs/plans/safejs-baseline-20260911/package-test-summary.json`) retains per-file totals. The 47 skipped tests are 33 optional filesystem conformance cases, 11 native Temporal controls (seven clone, four Instant), two native f16round controls and one optional fuzz case. Their absence is not conformance evidence.

## Establish-baseline revalidation

This is the current execution receipt, begun 2026-09-12 UTC (2026-09-11 America/Chicago). Earlier receipt files are preserved. The compatibility target and immutable extension revisions above remain unchanged. This is an audit/documentation task: no runtime repair, README edit, exploratory-test adoption, commit, push or publication is part of this execution.

The local source remains `d126d355c150a076e6c5d5f110162289c57ed1c9`, Node `22.23.2`, ICU `78.2`. Newly executed checks and fresh external observations are recorded separately from the earlier baseline. A local source result does not qualify the full newer remote tree, a recording probe with exit 0 is not an assertion pass, and successful package publication does not close feature-level gaps.

The prior-manifest preservation check (local historical evidence: `docs/plans/safejs-baseline-refresh-20260912-ledger/preservation-initial.json`) found 58 of 59 earlier original-file hashes unchanged and the staged binary diff unchanged (`839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`). The exception is the existing language plan, historical record `H-0424`: its current `establish-baseline.reproduce` status is `done`, whereas the earlier inspection recorded `open`. This task did not edit that file or alter task statuses. Its changed hash is preserved as a new observation rather than overwritten or treated as evidence of compatibility closure. The old blanket preservation statement belongs to its earlier check only.

### Refreshed category coverage and authority

The fresh inventory revalidation (local historical evidence: `docs/plans/safejs-baseline-refresh-20260912-target/inventory-revalidation.json`) confirms the same clean Test262 revision, **53,876 JavaScript files, 294 suffix fixtures, 18,651 valid headers without feature tags, 199 declared features (198 observed; `export-defer` has zero fixtures), and 270 directory rows**. All category counts and canonical path-list digests reconcile. The existing category-to-task map (local historical evidence: `docs/plans/safejs-baseline-20260911/category-inventory.md`) remains the authoritative map; fresh verification preserves its stable IDs rather than creating competing rows. Its Gate G provides the required runtime cells, pinned path or clause, reproduction/control, TDD regression, original/pending/completed replay, installed-artifact probe and release receipt for every unresolved row.

The fresh structure check (local historical evidence: `docs/plans/safejs-baseline-refresh-20260912-ledger/structure-initial.json`) finds **1,447 unique mapped IDs**: 199 features, 270 directory categories, 955 historical records, 11 exploratory files and 12 current cases. All recorded primary owners resolve among the current 33 task IDs. Of 966 historical/exploratory fingerprints, **965 match**, with only the externally changed `H-0424` noted above. The fresh receipt retains its current fingerprint and existing primary owner; it remains unverified. This is inventory coverage, not 1,447 passing semantic cases. Historical records are leads, and a document with several claims retains every claim under its primary owner's inherited gate until separately resolved.

The official edition title/content receipts and supported Node release index were freshly checked; the published target and runtime matrix remain unchanged. All named newer API pins remain separate from the base edition. Edition membership not yet reconciled to a fixture is explicitly unverified and remains assigned; it cannot enter edition pass totals by assuming that Test262's current “standard” heading means ES2025.

Fresh target and publication receipts (local historical evidence: `docs/plans/safejs-baseline-refresh-20260912-target/target-inventory-refresh.md`) confirm remote main `79999cba7bb7bae0581a7a1ba035c4abed6f0397`, scoped package `@poe-platform/safe-js@0.1.559`, umbrella `poe-code@15.0.24`, their recorded integrity values and the two successful release workflows remain unchanged. These are read-only observations of already published artifacts. The existing four-cell installed-artifact probes remain explicitly earlier evidence; refreshing metadata does not rerun their programs. No local ledger commit, remote delivery of this ledger, or new release is claimed.

### Additional initial failure: public-input qualification timing

This row extends the canonical category-to-task map; it does not replace the existing `C-PERFORMANCE` or `C-RECOVERY` obligations. The fresh full package run observed a tracked assertion timeout that the earlier baseline did not report. Its original failed attempt must remain in the ledger even if an unchanged focused retry passes.

| Field                              | C-INPUT-PROJECTION                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primary owner                      | `qualify-resource-and-timing-behavior`                                                                                                                                                                                                                                                                                                                                                                             |
| Dependencies                       | `qualify-public-api-and-diagnostics`, `qualify-realms-and-recovery`, `qualify-snapshot-adversarial-input`, `verify-integrated-candidate`; inherited runtime/provenance/release dependencies from Gate G                                                                                                                                                                                                            |
| Standard / contract / reproduction | Public host-input and recovery contract, not an ECMA-262 cloning operation. Maintained [input-error-projection.test.ts](../../packages/safe-js/test/integration/input-error-projection.test.ts), assertion “records raw public-input qualification without substituting it for O12”; execute the fresh package command below or the focused command in its check receipt.                                          |
| Evidence and disposition           | Fresh CI22/local-source package execution failed this assertion after 5,008 ms with the terminal error `Test timed out in 5000ms.` The original failure and focused counterevidence are retained in the fresh check receipt. Root cause and broader reliability remain **unverified**. Expected rejection of an unsupported raw host Error remains an **intentional boundary**, not evidence of a language defect. |
| Required runtime cells             | MIN, N18, N20, CI22, N24, N26; BUN/WORKERD require an equivalent public-contract probe where the Node child-process harness is inapplicable, with inapplicability recorded. No absent harness is a pass.                                                                                                                                                                                                           |
| Regression and acceptance          | Retain the failing original receipt; rerun the maintained fixture unchanged. Diagnose input, process transport, host load and runtime cost separately. Any validated repair requires a fast failing maintained regression and unchanged assertion/deadline/budget. A focused pass is bounded counterevidence, not erasure of the full-run failure.                                                                 |
| Original and replay                | Preserve raw-input rejection plus neighboring modeled capture, pending proof recovery and completed replay assertions. Prove explicit authority, identity/provenance and no duplicate host calls; do not substitute a modeled proof for raw-input qualification.                                                                                                                                                   |
| Artifact probe                     | Repeat the observable public behavior with the exact installed artifact and retained source/runtime identity; `SAFEJS_O12_API=built` is the fixture's maintained built-entrypoint control, not by itself a fresh npm-artifact receipt. Unexecuted current artifact cells remain unverified.                                                                                                                        |
| Release receipt                    | None for a fix: no repair or new delivery occurred. Require exact remote fix ancestry, terminal publication and installed-artifact check before `delivered`/`published` disposition. Existing baseline publication does not close this case.                                                                                                                                                                       |

### Fresh maintained checks and bounded probes

Fresh check receipts (local historical evidence: `docs/plans/safejs-baseline-refresh-20260912/check-results.md`) retain the exact commands, environment, raw outputs and exit codes. The maintained selected workspace build closure and repository `npm run lint` both completed with **exit 0**; SafeJS postbuild passed all seven built-import checks. Lint success applies to its maintained admitted scope and does not validate existing excluded Safe Bash contents.

The newly executed ISO/Promise exploratory selection completed with **exit 1: seven failed, 13 passed, no skips**, reproducing the same six ISO failures and one Promise-symbol expectation. Fresh built/native controls again agree on missing ISO long month parts and passing Gregorian/short neighbors. Dispositions remain shared backend limitation requiring normative qualification and intentional host-admission boundary/requested capability gap respectively; no speculative runtime repair follows.

The newly executed selected Test262 control report completed with **exit 1: 18 files, 35 variants, 32 passed, zero failed, three unsupported** (one module and two blocking-mode variants). The separate Temporal extremes selection completed with **exit 1: three files, six failed variants**, with zero unsupported or metadata/execution errors. These are initial failure/exclusion receipts, not a full-corpus or replay qualification claim; all original owners and acceptance gates remain in force.

To reproduce a selected conformance command when the recorded temporary corpus no longer exists, acquire a separate clean upstream checkout and substitute its path for `--corpus`. Keep each `--report` destination new; do not overwrite a recorded report. These preparation commands affect only a new temporary upstream checkout, not this repository or its branch:

```sh
safejs_test262_dir=$(mktemp -d /tmp/safejs-test262-repro.XXXXXX)
git clone --no-checkout https://github.com/tc39/test262.git "$safejs_test262_dir"
git -C "$safejs_test262_dir" checkout --detach 419d3e0a2273ba01a3bfcbec423f2801425b8e93
git -C "$safejs_test262_dir" rev-parse HEAD
git -C "$safejs_test262_dir" status --porcelain
```

The revision must equal the pinned SHA and status must be empty. Acquisition is a reproduction recipe, not an additional corpus execution. The fresh checks used the already clean pinned checkout identified in their receipts.

`C-TEMPORAL-EXTREME` has the explicit disposition **defect of the separately pinned Temporal extension**, bounded to valid minimum PlainDate formatting throwing `RangeError` at local source `d126d355c150a076e6c5d5f110162289c57ed1c9` / Node `22.23.2`. The retained edition/extension reconciliation (local historical evidence: `docs/plans/safejs-baseline-20260911/category-inventory.md#edition-boundary-and-precise-temporal-extension-contract`) links the exact proposal's `HandleDateTimeTemporalDate` no-TimeClip behavior and ordinary/maximum passing controls. This is not an ES2025 defect. Backend attribution, later assertions within those fixtures, remote/runtime breadth and replay remain **unverified**: each failed variant aborts at its first minimum-date failure, so six failed variants do not prove six distinct semantic defects or execution of later PlainDateTime/PlainYearMonth assertions.

The fresh maintained package command completed with **exit 1** after **1,951.88 seconds**: **29,012 passed, eight failed, 47 skipped tests** (29,067 total), across **1,308 passed, three failed, two skipped files** (1,313 total). Seven failures are the unchanged untracked ISO/Promise exploratory assertions. The eighth is tracked `C-INPUT-PROJECTION`, whose terminal error is `Test timed out in 5000ms.` Thus the earlier clean tracked-subset result is historical evidence, not the result of this fresh command. The package run overlapped the build and lint jobs, and a preexisting lint process was left untouched; this is relevant execution context, not proven timeout causation.

Fresh terminal accounting (local historical evidence: `docs/plans/safejs-baseline-refresh-20260912/package-test-summary.json`) partitions that single command as follows; these are not separate suite runs:

| Source status           | Passed / failed / skipped tests | Passed / failed / skipped files |
| ----------------------- | ------------------------------- | ------------------------------- |
| Tracked                 | 28,903 / 1 / 47                 | 1,299 / 1 / 2                   |
| Untracked exploratory   | 109 / 7 / 0                     | 9 / 2 / 0                       |
| Actual combined command | 29,012 / 8 / 47                 | 1,308 / 3 / 2                   |

All 47 skip names and eight failure details remain in the machine-readable receipt. The skip groups remain 33 named filesystem reference gaps, 11 unavailable native Temporal controls, two unavailable native `Math.f16round` controls, and one opt-in parser fuzz case. No skip, optional profile or unsupported variant counts as a pass; untracked exploratory successes remain local observations rather than shipped regression coverage.

The unchanged focused O12 file then **passed all 19 tests, exit 0, 16.81 seconds**, with the raw public-input assertion completing in **516 ms** under its unchanged **5,000 ms** deadline. Its exact command and log are in the fresh check receipt (local historical evidence: `docs/plans/safejs-baseline-refresh-20260912/check-results.md`). This bounded focused pass records working neighboring capture/pending/completed-replay assertions after the broad-run timeout; it does not repair or erase that failure. `C-INPUT-PROJECTION` therefore remains an observed timing failure with cause/reliability **unverified**, owned by `qualify-resource-and-timing-behavior`.

### Revalidation acceptance and remaining work

The `establish-baseline` audit is complete with an explicit failing baseline. The fixed published editions and Test262 revision make the target finite; every declared feature, directory category and historical/exploratory record retains an ID and primary owner; the added timing case has its own complete acceptance row. Fresh maintained tests, lint, build and selected conformance probes all have terminal receipts. Current ISO and Promise-symbol observations, the separately pinned Temporal defect, runner exclusions, skipped controls and the tracked timing failure remain visible with their distinct dispositions.

This does not claim compatibility closure, a fully passing maintained suite, full-corpus execution, every runtime/replay cell, or publication of a repair. Fixture-to-edition reconciliation, broader runtime/replay/artifact qualification and case repairs remain assigned to the map's owners. No budget, assertion, timeout, supported runtime, host authority, realm/replay invariant or failing test was weakened to reach this audit result. No runtime source or test was changed, so no repair TDD cycle is claimed. No screenshot is needed because no visual CLI behavior changed.

Final documentation verification (local historical evidence: `docs/plans/safejs-baseline-refresh-20260912-ledger/verification-final.json`) confirms **1,448 mapped IDs** including the new timing case, valid primary ownership, resolved authored local links and balanced command fences. The original staged diff and local HEAD remain unchanged. Of 966 historical/exploratory source fingerprints, only the previously observed external language-plan change `H-0424` differs from the earlier manifest; all 11 exploratory test files remain unchanged and untracked. The final preservation result does not falsely claim that this external plan edit was made by the audit or that its earlier hash is current. Terminal completion receipts (local historical evidence: `docs/plans/safejs-baseline-refresh-20260912/completion.json`) pin the fresh check artifacts and exit codes. Local commit: none. Verified delivery of this ledger: none. New publication: none; only the independently rechecked baseline releases are published receipts.

## Final candidate audit — 2026-09-12

Started 2026-09-12 00:50 UTC at source `d126d355c150a076e6c5d5f110162289c57ed1c9`, Node `22.23.2`, ICU `78.2`. This audit preserves the published edition, Test262 and extension pins above. It reruns selected evidence and records its own outcomes; neither inherited successful checks nor inherited failures are silently promoted to current results.

The initial preservation receipt (local historical evidence: `docs/plans/safejs-baseline-final-audit/ledger/preservation-initial.json`) fingerprints 133 pre-existing modified/untracked files, the complete runtime versions and staged binary diff `839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`. The independent structural check (local historical evidence: `docs/plans/safejs-baseline-final-audit/ledger/structure-initial.json`) reconfirms the prior 1,447 map rows and valid primary owners. The already documented `C-INPUT-PROJECTION` now has a central map cross-reference, and eight priority checkpoint leads have separate case rows, yielding **1,456 unique IDs**: 199 feature categories, 270 directory categories, 955 historical records, 11 exploratory files and 21 current cases. Gate G and the detailed timing-case acceptance fields remain authoritative.

Of 966 historical/exploratory fingerprints, 965 still match the original inventory. Historical record `H-0424`, the existing language-completeness plan, has SHA-256 `bc0fe69890347826b699746cb6dce23438b723b5ae88b680f6b7e15aeb51d661` at this audit's initial observation. Its earlier fingerprint and status observations remain historical; this audit did not edit that plan. All 11 exploratory test files are still untracked and their original fingerprints match.

All selected fresh maintained checks now have terminal receipts; none remains running or incomplete. The failed commands and unavailable runtime cells below remain nonpasses. No source repair, test adoption, local commit, remote delivery of this ledger or new publication is claimed.

### Category-map review and current evidence limits

Independent review corrected Gate G to preserve the upstream-declared **Script or Module context, strict/non-strict, async, negative-phase/error-type and agent/blocking variants**. Unsupported modes remain recorded; Script wrappers cannot substitute for module execution. Directory rows explicitly enumerate all descendants, including untagged sources and separately accounted helper fixtures.

Eight checkpoint leads now have explicit case IDs: `C-IMPORT-ATTRIBUTE-REFLECTION`, `C-ASYNC-OPTIONAL-REJECTION`, `C-LIVE-REALM-CALLBACK-ADMISSION`, `C-MATH-CONTEXT-FREE-COERCION`, `C-TYPED-ARRAY-LEGACY-ALLOCATION`, `C-TEMPORAL-OFFSET-PORTABILITY`, `C-TEMPORAL-REVERSED-RANGE-ORACLE` and `C-TEMPORAL-SKIPPED-CIVIL-DAY`. Each retains concrete record evidence, one primary owner, cross-feature dependencies and inherited runtime/reproduction/regression/replay/artifact/release acceptance. These are extracted leads, not newly reproduced defects. In particular, the reversed-PlainTime-range rejection expectation was a historical oracle mistake; the case does not assert that current acceptance of the range is a defect.

The **955 historical rows are a record-level inventory, not an exhaustive claim-by-claim census**. Their owners must extract each actionable claim into stable child case IDs or link an existing covering case before closing a record. Every child needs an individual disposition and dependencies; resolving one claim cannot close its siblings. This audit establishes complete Test262 category inventory and owned historical evidence, while complete atomization of historical prose remains explicitly unverified. Neither document hashes nor broad owner assignment prove that every embedded claim has been independently qualified.

### Latest maintained package outcome

The fresh package summary (local historical evidence: `docs/plans/safejs-baseline-final-audit/checks/package-test-summary.json`), raw JSON (local historical evidence: `docs/plans/safejs-baseline-final-audit/checks/package-test.json`) and terminal log (local historical evidence: `docs/plans/safejs-baseline-final-audit/checks/package-test.log`) record **exit 1**, **1,366.26 seconds**, **29,013 passed, seven failed and 47 skipped tests** across **1,309 passed, two failed and two skipped files**. All seven failures are the unchanged exploratory ISO/Promise assertions. The tracked `C-INPUT-PROJECTION` assertion passes in this actual whole-package invocation at **386 ms**, under its unchanged 5,000 ms deadline. This is new whole-package counterevidence, not a focused replacement for a broad gate. The earlier timeout remains a real historical observation whose cause and repeatability are unverified; this pass is not a repair claim.

| Partition of the single fresh package command | Passed / failed / skipped tests | Passed / failed / skipped files |
| --------------------------------------------- | ------------------------------- | ------------------------------- |
| Tracked                                       | 28,904 / 0 / 47                 | 1,300 / 0 / 2                   |
| Untracked exploratory                         | 109 / 7 / 0                     | 9 / 2 / 0                       |
| Combined terminal command                     | 29,013 / 7 / 47                 | 1,309 / 2 / 2                   |

These partitions are not separate suite executions. The package command still failed; tracked successes do not make its exit status successful or promote the untracked cases to shipped regressions. All skipped names and failure details remain in the receipt. This execution ran its package gate before its build/lint jobs, reducing audit-created contention without proving the cause of the prior timeout.

### Independent target and artifact controls

The fresh inventory receipt (local historical evidence: `docs/plans/safejs-baseline-final-audit/target/inventory.json`) independently reconciles **199 declared features, 198 observed features, 270 directory categories, 53,876 JavaScript files, 294 fixture/header exceptions and 18,651 valid untagged headers**. `export-defer` remains the declared feature with no observed fixture. Counts and category path digests agree with the canonical manifest. This is complete category inventory, not full semantic execution or completed fixture-to-edition reconciliation.

The fresh target and release observation (local historical evidence: `docs/plans/safejs-baseline-final-audit/target/target-release.json`) rechecks official edition content, Node release metadata, published package metadata and successful workflows. Remote main remains `79999cba7bb7bae0581a7a1ba035c4abed6f0397`; SafeJS remains `@poe-platform/safe-js@0.1.559`, and the umbrella package remains `poe-code@15.0.24`. These are observations of the previously published baseline, separate from the older local source under maintained checks. The exact artifact entrypoint SHA-256 is `9a505a17047f5d6f17785ae090385082421a592b792f7311e102ec4c49c514ed`. The probes use the previously installed published artifact with its bytes rechecked; this audit did not perform a fresh installation. Target receipts (local historical evidence: `docs/plans/safejs-baseline-final-audit/target/target-receipts.md`) retain runtime support, workflow path filters and freshly decoded provenance for all four packages; signatures were not independently verified.

Manual artifact QA (local historical evidence: `docs/plans/safejs-baseline-final-audit/target/manual-artifact-qa.md`) was executed identically on seven runtime cells; its fenced probe SHA-256 `70f81e16b949193a77bec60717ef873267e2f84575ec800ac0f501aab44c5020` independently matches the raw receipt (local historical evidence: `docs/plans/safejs-baseline-final-audit/target/runtime-artifact-probes.json`). Each cell records **10 passing controls and one failing requested native Promise-symbol admission check**. Recorder exit 0 does not mean every assertion passed. The controls cover astral lexical names/negative zero, syntax rejection, absent ambient authority, retained guest symbols, a host getter never invoked, native/guest Intl agreement, and a deterministic original/checkpoint/completed-replay round trip. The round trip does not qualify pending Promise/ISO recovery or category-wide replay.

| Runtime cell | Exact runtime / ICU                                                                     | Artifact control outcome                                         |
| ------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| MIN          | Node 18.18.0 / 73.2                                                                     | 10 controls pass; requested native Promise symbol fails          |
| N18          | Node 18.20.8 / 74.2                                                                     | 10 controls pass; requested native Promise symbol fails          |
| N20          | Node 20.20.2 / 78.2                                                                     | 10 controls pass; requested native Promise symbol fails          |
| CI22         | Node 22.23.2 / 78.2                                                                     | 10 controls pass; requested native Promise symbol fails          |
| N24          | Node 24.21.0 / 78.3                                                                     | 10 controls pass; requested native Promise symbol fails          |
| N26          | Node 26.8.2 / 78.3                                                                      | 10 controls pass; requested native Promise symbol fails          |
| BUN          | Bun 1.3.11 / 74.2; compatibility `process.versions.node` 24.3.0                         | 10 controls pass; requested native Promise symbol fails          |
| WORKERD      | Required workerd 2026-09-01; executable absent from PATH (`command -v workerd`, exit 1) | Unexecuted and unverified; no Node/Bun result substitutes for it |

Native-agreement ISO checks are controls, not an oracle declaring every observed localized result correct. The fresh ISO/Promise matrix (local historical evidence: `docs/plans/safejs-baseline-final-audit/target/iso-promise-artifact-matrix.json`) records **N20 and CI22** missing ISO Date/Temporal month values while agreeing with their native backend; the other five tested cells return populated values for the selected inputs. This is a runtime-specific gap, not a universal runtime failure or a repair. Native Promise own string data returns `7`, but its user symbol count returns `0` instead of requested `1` on all seven cells; guest-created Promise symbols and the getter authority negative control pass. Thus `C-ISO` and `C-PROMISE-SYMBOL` retain their qualified backend and explicit admission-boundary dispositions.

The initial artifact attempt (local historical evidence: `docs/plans/safejs-baseline-final-audit/target/runtime-artifact-probes-initial.json`) incorrectly passed the asynchronous dump result directly to restore. Its validation errors are retained as **QA setup failures**, not product failures. The corrected probe awaits and parses dump output according to the SDK contract; it does not weaken a product assertion or count the initial attempt as passing.

### Terminal build, lint, conformance and negative controls

Final check receipts (local historical evidence: `docs/plans/safejs-baseline-final-audit/checks/check-results.md`) provide exact commands, unchanged budgets/timeouts and all outputs. The completion manifest (local historical evidence: `docs/plans/safejs-baseline-final-audit/checks/completion.json`) pins each receipt hash and terminal exit. The maintained selected SafeJS build closure (`npm run build:workspaces -- --workspace=@poe-code/safe-js`) and repository `npm run lint` both **passed, exit 0**. SafeJS postbuild passed seven built-import checks. Root lint completed ESLint, type contracts and workflow lint; its reported ignored/unconfigured files and five held boundaries remain exclusions, not validated contents. Whole-repository `npm test` and `npm run build` were **not run**: this documentation-only audit used the narrow maintained SafeJS package test and declared build closure. Their absence is not replaced by a root-only test command or a focused rerun.

| Fresh selected probe                          |                 Passing |                          Failing | Skipped / unsupported                                 | Terminal status                    |
| --------------------------------------------- | ----------------------: | -------------------------------: | ----------------------------------------------------- | ---------------------------------- |
| ISO/Promise exploratory reproduction          |           13 assertions |                     7 assertions | 0 skips                                               | Exit 1                             |
| Pinned Array.of plus module/blocking controls |             32 variants |                                0 | 3 unsupported: one module, two blocking-mode variants | Exit 1; 18 files / 35 variants     |
| Pinned Temporal no-TimeClip selection         |                       0 |                       6 variants | 0 unsupported                                         | Exit 1; three files / six variants |
| Native/built neighboring controls             | All recorded assertions |                                0 | No full-feature qualification implied                 | Exit 0                             |
| Temporal edge recording                       |    Two values formatted | Valid minimum records RangeError | Below-minimum rejection is a negative control         | Exit 0 means recorder completion   |

The Temporal edge controls (local historical evidence: `docs/plans/safejs-baseline-final-audit/checks/temporal-edge-controls.jsonl`) independently distinguish valid minimum `-271821-04-19` (`RangeError: Invalid time value`), ordinary and maximum dates (format), and one day below the minimum (`Out-of-bounds date`, expected rejection). The six upstream failed variants abort at their first failure; they do not establish six distinct defects or execute later assertions. `C-TEMPORAL-EXTREME` remains a defect of the separately pinned Temporal extension, with later assertions, backend attribution and broader runtime/replay qualification unverified.

The native/built controls (local historical evidence: `docs/plans/safejs-baseline-final-audit/checks/native-built-controls.jsonl`) compare ISO/Gregorian long/short parts for en-US/pl-PL/ru-RU, retain guest-created Promise symbol semantics, and confirm a host-private symbol getter is neither admitted nor invoked. These independently verify current authority behavior without pretending to qualify active/retired context transfer. The two module/blocking exclusions are runner limitations; they do not establish language defects or authorize ambient module resolution/blocking. No code, assertion, budget, timeout, supported runtime or host authority was changed.

### Final evidence assessment and preservation

The finite published target, complete **199-feature / 270-directory** Test262 category map, required runtime matrix, concrete ISO/Promise reproductions, terminal maintained checks and explicit initial failure/exclusion ledger are evidenced. The map's **1,456 unique IDs** each have a primary owner and inherited acceptance obligations. The 21 explicit current cases expose priority unresolved findings and authority boundaries; the 955 historical records remain owned evidence with claim extraction required before closure. This establishes the baseline deliverable without claiming an exhaustive atomized historical-gap census or compatibility closure.

Remaining work is explicit: full corpus/variant execution and fixture-to-edition reconciliation; individual historical-claim extraction and current qualification; unavailable Workerd and other unexecuted runtime cells; pending/replay/realm and artifact breadth; the Temporal extension defect; ISO backend/normative qualification; the requested Promise admission change; and the historical timeout's unexplained cause. None is counted as passing, delivered or published. Historical successful publication proves only the identified baseline artifact. Local ledger commit: **none**. Verified remote-main delivery of this ledger: **none**. New publication: **none**.

The manual documentation QA procedure (local historical evidence: `docs/plans/safejs-baseline-final-audit/ledger/manual-qa.md`) was executed after terminal checks. Final verification (local historical evidence: `docs/plans/safejs-baseline-final-audit/ledger/verification-final.json`) records map ownership, local links, command fences, receipt hashes and preservation comparisons. Only the canonical ledger and its category map changed among the 133 initially fingerprinted files; all unrelated files, all 11 exploratory tests, local HEAD and the staged binary diff remain unchanged. No screenshot applies because this evidence-only task changes no visual CLI behavior.
