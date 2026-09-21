# ssconvert domain scaffold verification

Task: scaffold-domain-package. Verified 2026-09-19 in the authorized worktree.
This records a domain scaffold, not complete Gnumeric compatibility or release
qualification. Root performed package/public-export/integration review and owns
Git. A different agent performed independent stress/fix and final review.

## Reference and scope

Downloaded the official Gnumeric 1.12.61 archive only into
out/ssconvert-scaffold. Its measured SHA-256 was
2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12.
Inspected src/ssconvert.c main options, scalar/array declarations, action
precedence, incompatibility check and capability execution order. No primary
source, native binary or source-derived implementation was vendored.

The existing [reference profile](reference-profile.json),
[architecture](architecture.md), [specification](../specs/ssconvert.md) and
[coverage register](coverage.json) retain their dependency/plugin/locale captures
and incomplete gates unchanged. This task did not run a native oracle or add
native differential, codec, numerical, rendering or deployed-service coverage.

## Implemented and reviewed

- Private TypeScript ESM workspace @poe-code/ssconvert, root public subexport
  poe-code/ssconvert, guarded build/declaration/maps, package lock and explicit
  root packed-file membership. Runtime dependency map is empty.
- Small domain modules for CLI, workbook, formulas, formatting, codecs,
  rendering and solver/analysis. Public types cover ordered typed updates,
  repeated exporter option strings, conversion/merge/split/graph/range/clipboard/
  analysis requests, directional service registry and required runtime limits.
- One real conversion engine reads injected bytes through an installed reader,
  snapshots a bounded sparse workbook, applies ordered updates and supplied
  numerical capabilities, invokes the installed writer and awaits publication.
  SDK and CLI share this engine; there is no second conversion implementation.
- Explicit byte source/sink, filesystem, env/locale/timezone, optional clock/
  random, cancellation and cooperative owned cleanup inputs. Retained producer
  chunks are copied before advancement. No ambient host files, subprocesses,
  credential reads, automatic network/clipboard access or native fallback.
- Opt-in ssconvert virtual plugin and Safe Bash command subexport plus Node root
  export. Root reviewed VFS binding, shell budget forwarding, owned invocation
  enrollment and cleanup, collision preflight and unchanged aggregate inventory.
- CLI scalar last-wins and ordered raw arrays remain separate from typed SDK
  options/updates. Source-verified capability order is updates, goal seek,
  solver, analysis, then explicit recalculation before output.

## TDD and independent stress evidence

Before implementation, original in-memory/memfs conversion contract cases
failed because the requested public implementation was missing. These became
executable shared CLI/SDK, update-order, option-order, chunk-ownership, budget
and namespace-effect cases.

Independent stress reproduced failing assertions for synchronous cleanup
admission, publication after externally closed cleanup, NUL in consumed CLI
values and dispatch after capability cancellation. Repairs close admission,
drain cooperative work, await LIFO cleanup, check cancellation/admission at each
capability boundary and validate consumed values. Seven independent cases also
cover abort-reason identity and aggregated cleanup errors.

Root then reproduced and repaired three additional assertion failures: omitted
required input budget was accepted; eager VFS reads admitted 100 bytes rather
than a shell limit of 2; invalid engine limits leaked one invocation abort
listener. Final assertions require rejection, a 2-byte read admission and zero
remaining listeners respectively. An additional source-order regression first
observed recalc/goal/solve/analysis and now requires goal/solve/analysis/recalc.
The cancellation stress case uses goal seek as the aborting capability and
still requires no later solve, recalc, encoding or file publication.

All canonical unit fixtures are original in-memory data. Unit file changes use
memfs; no unit test writes host files, runs native utilities or queries an LLM.

## Passed checks

| Route                                                                                             | Verified coverage                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache                            | Final fresh domain ESM/declaration/map build                                                                             |
| npm run test:unit --workspace=@poe-code/ssconvert                                                 | 12 passed: 5 root contract cases and 7 independent stress cases                                                          |
| npm run lint --workspace=@poe-code/ssconvert                                                      | ESLint, source TypeScript and test TypeScript                                                                            |
| npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache                        | Initial fresh maintained 18-workspace dependency closure passed                                                          |
| npm run build --workspace=@poe-platform/safe-bash                                                 | Final guarded package build plus native npm postbuild stage passed after root repairs                                    |
| node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/ssconvert.test.ts | 4 passed: shell VFS conversion, unsupported namespace preservation, read budget admission and failure cleanup            |
| npm run test:runner --workspace=@poe-platform/safe-bash                                           | 558 passed; guarded build, integration membership, compression assets, reporting and historical type-model runner checks |
| Focused ESLint                                                                                    | Adapter, command tests, Node export entry, modified build and integration-membership scripts                             |
| Built public-consumer TypeScript                                                                  | Strict NodeNext consumer imports domain contracts and both Safe Bash root/command exports; no emit                       |
| Built public runtime imports                                                                      | Root domain export, Safe Bash command subexport and matching Safe Bash Node root function identity                       |
| npm pack --ignore-scripts --dry-run --json                                                        | Root pack manifest includes all 40 ssconvert dist artifacts; no packed installation or release claim                     |
| Prettier and git diff --check                                                                     | Owned new source/config/docs formatting and whitespace                                                                   |

Tests, ESLint and consumer compilation ran fresh without their optional caches;
workspace build checks explicitly selected --no-cache. The exact command test
path is registered in the maintained integration-membership assertion. No
historical inventory or sealed fixture was changed.

Ad hoc visual verification used the maintained screenshot command with an
isolated host harness invoking the actual opt-in plugin. Inspected image showed
the single intact diagnostic `Unsupported ssconvert feature: recalculation` and
status 1. No screenshot tests or root poe-code command integration are claimed.

One repeat build overlapped an authorized source repair and correctly failed
with `compiler input identity changed: size`; it was not counted as a pass.
After edits stopped, final domain and guarded Safe Bash builds passed. All
task-owned downloaded source, scratch harnesses, temporary logs and screenshot
evidence were removed from out after recording results.

## Unresolved delivery and compatibility gates

1. Package README publication requires explicit permission. The complete
   [usage/config/environment draft](usage-draft.md) is prepared, but no package
   README exists and the repository's package-documentation requirement remains
   **unmet**. The draft is not a substitute or a completed delivery gate.
2. The broader maintained `npm run typecheck --workspace=@poe-platform/safe-bash`
   failed in its current root peer-profile prerequisite: `Public SafeFS must
preserve shared SafeJS runtime identity`, actual undefined versus required
   ./packages/safe-js/dist/safe-fs.js. The checkout root manifest has no public
   ./safe-fs entry. No consumer compilation began in that route. Its assertion
   was preserved; focused built new-export consumers passed separately. No
   unrelated root SafeFS export was invented to bypass this prerequisite.
3. No built-in codecs or complete workbook model are implemented. Service
   selection is explicit ID/extension only; native probing, priorities,
   save scopes, interactive filtering and default writer policies are pending.
   Native format/function/tool lists are reference evidence, not implemented
   registries. Conversion using a fixture codec proves engine dispatch only.
4. Merge, split, sheet selection, export range, resize, graphs and clipboard
   expose typed boundaries but currently reject before I/O. Rendering and
   formatting interfaces do not provide implementations. Numerical callbacks
   are injected host capabilities, not qualified JavaScript Gnumeric algorithms.
5. CLI raw update/goal/analysis grammar, implicit output naming, native listing
   serialization, verbose diagnostics, inherited library/GTK flags, short
   clusters/attached values and arbitrary byte argv remain unsupported or
   unmeasured. The adapter currently rejects non-UTF-8 arguments. Captured help/
   version strings require an explicit host profile. Native automatic dirty
   recalculation is pending; only explicit supplied recalculation is dispatched.
6. Unsupported-feature diagnostics/status 1 are deliberate scaffold responses,
   not differential proof of native diagnostics. Qualified exact native exit
   statuses, warnings, ordering, output bytes and namespace effects for the
   full operation set remain open. No unsupported/unmeasured case is a pass.
7. Injected capabilities are trusted JavaScript. Limits bound engine admission
   and returned data; they do not preempt uncooperative work, establish a host
   memory/CPU ceiling or undo settled namespace changes. Filesystem hosts own
   authority/publication policy. Replay/realm interoperability, complete current
   packed Safe Bash qualification and native-profile gaps remain unmeasured.
8. Full npm test/root lint, deployed adapter interoperability, native differential
   and full visual/render gates were not run for this focused scaffold. The
   maintained scoped routes above are the actual measured coverage.

No local commit, push, remote-main delivery, publication or successful release
is claimed. No README files, pre-existing ssconvert audit files, unrelated edits,
sealed inventories or parent/global Git configuration were intentionally changed.
The dry-run packaging command invoked the repository's existing prepare hook;
this is not a release operation.

## Current-worktree independent requalification

The scaffold was already present at the start of this task continuation. Its
existing files and unrelated dirty edits were preserved; historical checks above
are not substituted for the fresh runs below. Base HEAD is
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`; this is an uncommitted candidate.
The candidate input fingerprint is
`89fe25b9967d86ae322a2187d671e8c01a7648c0306af5dd1fc831ea3a6277bb`:
SHA-256 of compact JSON containing sorted `[path, fileSha256]` pairs for root
package.json/package-lock.json, Safe Bash package.json, src/index.ts,
scripts/build.mjs, scripts/integration-inputs.test.mjs, the ssconvert adapter and
command test, and domain package.json, both TypeScript configs and every src
file. This binds the dirty candidate inputs, not a stored Git revision or the
whole repository.

A different agent reproduced two additional failing budget regressions before
repairing them: three goal-seek requests ran and published under an operations
limit of two, and one update plus two exporter strings also published under that
limit. Conversion now admits the aggregate count of updates, goal-seek requests,
exporter strings and requested recalculation/solver/analysis calls before reading
input. An exact-limit success control prevents a blanket-rejection fix.

Fresh verification passed:

- Official archive download confined to `out/ssconvert-current`, SHA-256 exactly
  `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`;
  inspected upstream scalar exporter options and capability ordering.
- Final uncached maintained domain build, 14 domain unit cases (5 contract and
  9 independent stress), domain ESLint and source/test TypeScript checks.
- Fresh uncached Safe Bash 18-workspace build closure; four command cases and
  all 558 maintained runner cases, with zero failures/skips/cancellations.
- Focused adapter/test ESLint, strict NodeNext public-consumer compilation and
  public ESM domain/command/root export identity checks.
- Original public-SDK negative controls: cross-engine workbook rejection without
  sink effects, exact binary output `[255, 0, 128]` at the byte limit, pre-aborted
  invocation preserving the original non-Error reason, and rejection after
  disposal. These deterministic controls do not measure performance or realms.
- Additional trusted foreign-realm public-SDK controls passed: reused producer
  chunks remained `[65, 66]`, a foreign workbook was snapshotted into frozen
  sheets/cells, foreign output remained `[255, 0]` and a foreign Error abort
  reason retained identity. These are narrow interoperability checks, not
  isolation, SafeJS/checkpoint/replay or arbitrary realm qualification.
- Manual Markdown QA screenshot step: actual opt-in plugin through the maintained
  screenshot tool; inspected intact recalculation diagnostic and status 1.
- Full `npm run build`, including the maintained workspace closure and all root
  suffix stages. Its workspace with no declared build is not a build pass.
- Owned changed files passed Prettier and whitespace checks.

The maintained Safe Bash typecheck route freshly failed its root public SafeFS
peer prerequisite: actual `undefined`, expected
`./packages/safe-js/dist/safe-fs.js`. It recorded zero consumer groups/runtime
executions and cleanup success. Root export inspection confirms the required
`./safe-fs` entry is absent. The assertion was preserved; the new public consumer
pass does not complete this broader route.

The first uncached full `npm test` failed before unit execution: guarded Safe
Bash optional-build admission detected `compiler input identity changed:
mtimeMs` during the independent domain declaration rebuild. The successful
separate build closure is not substituted for this failed full run.

The subsequent uncached full test run reached the root shared unit batch: 1,850
cases passed and its exact root-export inventory case failed because the new
`./ssconvert` export was missing from the literal expected list. Root repaired
that integration assertion and added exact declaration/runtime/packed-file
checks. The focused 19-case metadata suite then passed; this is not a full-gate
pass. The final candidate additionally includes
`tests/integration/standalone-package-metadata.test.ts` with SHA-256
`b452a9458b97db75d06679892ffa90bc7bd5291763b94c1f1b3d2b278db9b09b`.

Repository-wide `npm run lint` exited 2 with `complete: false`: 16,459
configured subjects were linted, zero style errors and four unrelated warnings,
but five held-input gaps reported checkout-root directory size drift
`1376 ↔ 1408`. The gaps are the stage-a-r2 common.mjs and f11-v2
binding.mjs/evidence/prepare.mjs/run.mjs receipt boundaries. Investigation of the
structured output found no parser/guard execution failure; admission rejected
ancestor namespace churn while builds/tests ran concurrently. This is an
incomplete root gate, not a clean lint pass. No guard, receipt or warning was
weakened. Independently executed maintained root `lint:types` and
`lint:workflows` completed successfully; these are substage passes only.

After build/write stages settled, the repeated complete `npm run lint` passed
with exit 0, including guarded ESLint, root type lint and workflow lint. Guarded
ESLint reported zero errors, four warnings, zero admission gaps and
`complete: true`. The earlier exit-2 attempt remains recorded above.

### Final request-ownership follow-up

An additional original failing case reproduced an alias bypass after aggregate
admission: one admitted goal under operations=2 became three when the importer
appended goals and changed the original value/range. The solver received
`goals:3:changed:99` and publication succeeded. Conversion now captures admitted
ordered arrays, cell values, goal ranges, analysis properties and resource
descriptor scalars synchronously before session host callbacks; byte sources and
sinks stay borrowed explicit capabilities. A separate failing allocation
control (three analysis properties under operations=2) led to property-array
admission before copying. Exact-limit controls still succeed.

The capture repair initially changed disposed-engine precedence. Two failing
regressions reproduced unsupported-feature/cancellation outcomes instead of the
existing disposed-engine rejection. A pre-capture disposed check restores the
original order while retaining asynchronous Promise rejection. Final source
lint and source/test TypeScript checks passed, and all 20 domain tests passed
fresh (5 contract, 15 independent stress), without unit host file writes,
native subprocesses or LLM calls.

These final domain edits happened after the complete root build/lint and shared
unit batches. Those broader results bind the preceding candidate; they are not
full-final-candidate qualification. Root completed the final scoped rebuild and public/command verification
recorded below after broad host execution settled.

README publication remains unauthorized and the package documentation gate
remains unmet. No native oracle, built-in codec compatibility, mapped upstream
runtime/locale/plugin matrix, checkpoint/replay, realm isolation or performance
qualification is claimed. The unsupported/mismatch register above remains open.

### Final scoped candidate results

Final input fingerprint: `9a150854c6e6ef851261da1c33229e2656b2c9748d94cae134db1afe978b4d37` (26 files), using the same
sorted compact `[path, fileSha256]` algorithm and preceding scope, additionally
including the root metadata test and both edited S3 archive test files. This is
an uncommitted input identity, not remote-main delivery or whole-repository
qualification.

- Passed: uncached maintained domain build; all 20 domain unit cases; domain
  lint and both source/test TypeScript checks; final Safe Bash maintained build
  including postbuild; all four focused command cases.
- Passed: final strict public NodeNext consumer compilation and root/command
  export identity. Independent built SDK controls retained reused foreign chunks
  `[65, 66]`, exact foreign output `[255, 0, 128]`, frozen workbook ownership,
  cross-engine rejection before sink effects, foreign abort Error identity and
  disposed-engine rejection. These are deterministic trusted interoperability
  checks, not isolation or performance claims.
- Passed: focused ESLint for the final metadata/archive test edits and whitespace
  checks. The earlier inspected CLI screenshot still covers the unchanged CLI
  diagnostic path; no new visual behavior was added by request capture.
- Passed: complete final S3 archive test file, 224 cases: 222 passes, zero failures,
  two skips, zero TODOs/cancellations. The skips identify default committed HEAD
  lacking the reviewed `scripts/build.mjs` authority. Explicit requested revisions
  retain strict qualification; no archived revision is claimed qualified by
  these skips. Synthetic S3 fixtures now exclude the new spreadsheet dependency,
  consistent with their deliberately absent spreadsheet sources/public entries.

The latest complete root test invocation exited 1: its 19 shared batches ran,
then the Safe Bash route recorded 44,038 passes, 16 failures, 829 skips and two
TODOs across 44,885 cases; later workspace tasks did not run. Fourteen failures
were the synthetic spreadsheet dependency fixture admission and two were the
unavailable committed-HEAD prerequisite. Their final focused archive rerun is
recorded above, but does not turn the failed full invocation into a pass. Shared
batch skips/TODOs and unavailable codec/oracle matrix cells remain unverified.
The preceding complete root build and lint passes do not qualify the later domain
capture edits universally. The SafeFS peer typecheck prerequisite failure remains
open and no zero-consumer route is reported as a consumer pass.

README remains absent and its required package documentation gate remains unmet;
the usage/config/environment draft is prepared only. Built-in conversion codecs,
full Gnumeric semantics, upstream plugin/dependency/locale runtime cells,
checkpoint/replay, isolation and bounded performance remain unsupported or
unmeasured as recorded above. No local commits, pushes, publication or releases
were performed. Task-owned `out/ssconvert-current` scratch was removed after
recording these results; existing other evidence and unrelated edits were kept.
