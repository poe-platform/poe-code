# Host transport qualification integration — 2026-09-14

This integrates the previously local RR-1 through RR-7 host-admission and
metadata repairs on top of RR-8. The supported/rejection/version matrix passes
on the reconciled delivery source. Overall task acceptance remains incomplete:
uncaptured shared histories and Bun's shared-wrapper transport remain unresolved.

## Source and target

The clean delivery checkout starts at RR-8 commit
`5ad2344edc13cd11508cb0b4cee1828c8b9e2c26`, already verified on remote main.
The original user's main checkout, its divergent history, staged Safe Bash patch
and unrelated working changes are preserved. Only the task-specific transport
patch, supporting tests/fixtures and the two exact current-marker consumer
expectations are integrated. The inherited patch had two context mismatches;
these were reconciled without importing unrelated source-module or blocking-agent
work from the dirty candidate.

Environment: Node **22.23.2 / ICU 78.2**, Darwin arm64. Compatibility remains
ECMA-262 edition16 and ECMA-402 edition12 (June2025), Test262
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`, and explicitly tracked extensions
including Temporal `e8cc03fc970a65a3359e8870e3b35e687ac94e55`.

New executions use **jobs-v9**, because host data representation changes are
observable during replay. Genuine jobs-v6/v7/v8 resumes retain their original
representation; v8 retains its function-source hashing and text. Explicit
migration produces a fresh v9 continuation. Historical fixtures, digests and
recorded assertions are not relabeled. Tests for an unsupported future marker
now reject jobs-v10; they were not removed or converted into permissive checks.

## Changes and failing controls

Before repair, the selected clean-main controls produced **227 passes / 85
failures / zero skips**. This includes the 59 earlier matrix failures. Four of
those 85 assertions express the new v9 admission/current-marker transition;
they are not defects in the old runtime merely for using v8. The remaining
controls concretely reproduce metadata loss or unsafe host admission:

- Unsupported values could execute constructor/name getters while generating
  rejection diagnostics. Diagnostics now inspect data descriptors without
  invoking getters or inspecting Proxy constructors.
- Host null prototypes, boxed nonextensibility and symbol-keyed graph edges were
  lost. Explicit copied-object provenance distinguishes a semantic null prototype
  from an implementation backing object, preserving aliases and cycles.
- Native Map/Set subclasses and opaque Proxies were admitted, collection hooks
  could run, and collection descriptors/extensibility were dropped. Captured
  native collection intrinsics and bounded Proxy/prototype rejection now enforce
  the declared data boundary. Explicit realm capabilities retain their separate
  authority path.
- Symbol capabilities now use disjoint path segments and preserve identity even
  when symbols have the same description or strings resemble encoded paths.
  Symbol descriptions remain charged to the existing allocation budget.

Structured-clone normalization, guest classes and internal heap descriptor
transport retain their separate contracts. These host admission rules are not
claims that ECMAScript forbids native subclasses or Proxy. No arbitrary
live-realm interoperability or exactly-once effects are claimed.

After reconciliation, all **312 selected tests** pass, including every **156
supported transport**, **100 predictable-rejection** and **18 version-envelope**
cell, plus getter/proxy, provenance, symbol-budget and v8 compatibility controls.
A subsequent selection on the RR-8-based source passes **369 tests**, adding the
maintained harness loader and all 30 shared-argument graph controls.

The harness's saved-result check was independently reproduced failing with
`expected jobs-v8 / received jobs-v9` (one failure, six controls passing). Its exact
expectation and the root smoke command's exact expectation now require v9.
The resulting consumer selection passes **12 tests**. Every modified existing
assertion remains exact; only current/future execution-marker literals changed.

The two genuine archived v8 JSON fixtures are committed alongside the tests.
They exercise saved/completed replay and original function-source hashing.
The new protocol does not silently upgrade their observations. Package documents
explain the v9 transition, explicit host authority, sharedGraph coverage and the
still-unresolved uncaptured-history boundary. No README additions were made.

## Commands and verification

Run from the repository root in the delivery checkout:

```sh
npm ci
npm run build:workspaces -- --workspace=@poe-code/safe-js
CI=1 npx vitest run packages/safe-js/src/transport- packages/safe-js/src/host-symbol-paths.test.ts packages/safe-js/src/run.transport-v8-compatibility.test.ts packages/safe-js/src/interp/host-rejection-getters.test.ts packages/safe-js/src/interp/host-copy-prototype-provenance.test.ts packages/safe-js/src/interp/host-collection-admission.test.ts packages/safe-js/src/interp/host-proxy-admission.test.ts packages/safe-js/src/interp/host-proxy-error-boundary.test.ts
CI=1 npx vitest run packages/agent-harness/src/loader/run.test.ts packages/safe-js/src/transport- packages/safe-js/src/run.transport-v8-compatibility.test.ts packages/safe-js/src/interp/shared-argument-graph-recovery.test.ts
CI=1 npx vitest run packages/agent-harness/src/loader/agent-results.test.ts scripts/smoke-test.test.ts
npm run typecheck:contracts --workspace=@poe-code/safe-js
npm run build
CI=1 npm test
npm run lint
npm run smoke -- --prebuilt
```

The selected workspace build's maintained closure completes **23 builds** and
**eight built-import checks**. Scoped ESLint passes all 30 selected TypeScript
files before the two consumer-marker changes; repository-wide lint covers the
final scope. All **100** filesystem type-contract cells pass. The initial
package-only run was stopped (exit130) when the two consumer changes required
the broader root gate; it is not reported as a completed package gate. Final
root gate receipts follow below. No caller profile, budget, runtime support,
assertion or timeout was reduced.

Built-artifact QA combines cyclic Maps, duplicate-description symbols,
nonenumerable/frozen metadata, null prototypes and poisoned foreign prototypes
across bindings, registered modules, host returns, callbacks, persistent realms
and migration. All **84 distinct runtime/path checks** pass on Node18.18.0/ICU73.2,
18.20.8/ICU74.2, 20.20.2/ICU78.2, 22.23.2/ICU78.2, 24.21.0/ICU78.3,
26.8.2/ICU78.3 and Bun1.3.11/reported ICU74.2, with zero getter invocations.
A duplicate Node24 installation adds no support cell. Actual
**Workerd 2026-09-01** passes seven targeted controls, including v9 metadata,
JSON replay and zero-trap Proxy/prototype rejection; Workerd does not expose ICU.
Its maintained entry does not expose persistent realm/migration APIs, so those
are not inferred from the Workerd result.

Source hashes, exact commands, failing/passing JSON results, runtime versions,
Workerd source/bundle hashes and full gate logs are retained under
`transport-delivery-20260914/`. The source was checked for drift. Temporary
Workerd entry/config/bundle files were removed after recording hashes and
stopping only the task-owned server. No visual CLI behavior changed.

## Remaining disposition

The earlier **215/274 clean-main matrix** nonpass applies to the RR-8-only source.
This integration resolves that matrix's 57 metadata/admission failures and adds
the explicit v9 transition. It does not reinterpret the earlier failures as
passes. The broader transport acceptance is still blocked by separately recorded
shared-memory findings: queued raw host writes can produce **7 originally / 0 on
recovery**, and pending recovery can issue effects **[7,0]** before a later
mismatch. Bun's native shared-wrapper clone returns an ordinary buffer at the
recorded boundary. A byte copy would not preserve shared storage, and silently
rejecting otherwise supported execution would not be a compatibility repair.

Shared-history admission needs an explicit ownership/history design and legacy
rules that reject unsupported histories before resumed effects. Full cross-runtime
language conformance and deterministic native weak lifetime are not claimed.
Publication of the verified transport repairs does not complete those blockers.

Local commits, remote ancestry, required workflow conclusions and actual scoped
SafeFS/SafeJS/Safe Bash and poe-code versions are recorded separately. Required
publication is not complete while an affected package remains unverified.

## RR-8 publication receipt (completed)

- Local repair commit: `5ad2344edc13cd11508cb0b4cee1828c8b9e2c26`.
- Normal-hook push and subsequent fetch verified that exact SHA on remote main.
- [Scoped release 34832903400](https://github.com/poe-platform/poe-code/actions/runs/34832903400): success.
- [Root release 34832903636](https://github.com/poe-platform/poe-code/actions/runs/34832903636): success.
- [Schema pages 34832903317](https://github.com/poe-platform/poe-code/actions/runs/34832903317): success.
- Actual published versions: `@poe-platform/safe-js`, `@poe-platform/safe-fs`,
  `@poe-platform/safe-bash` **0.1.596** each; `poe-code` **15.0.39**.
- Every package tarball's SHA-512 matches registry integrity. SLSA attestations
  identify the repair commit and the corresponding GitHub publication run.
- Independently installed SafeJS and root SafeJS export each pass all ten shared
  graph controls. SafeFS read/write/error identity and Safe Bash memory-shell
  controls pass. Root legacy `safejs` and current `safe-js` export identity passes;
  installed CLI reports 15.0.39.
- `npm audit signatures` verifies **212 signatures / 41 attestations** in the
  consumer after root installation. The earlier scoped-only audit verified 17/11.
- SafeJS registry metadata initially lagged its tarball and provenance by minutes.
  E404/ETARGET attempts were retained; the exact version was retried successfully.
  No package was assumed published from a green workflow alone.

Raw package metadata, attestations, integrity checks, installed logs and workflow
receipts are retained in `rr8-repair-20260914/`. This receipt applies to RR-8;
it does not claim that the pending v9 integration or Bun fallback was published.

## Final integrated local gate

`npm run build` and the complete uncached `CI=1 npm test` route pass on the
reconciled source. Native npm lifecycle scripts and declared workspace membership
were retained. The route reports:

| Maintained task                    | Passed | Skipped | Failed |
| ---------------------------------- | -----: | ------: | -----: |
| Shared root/workspace Vitest batch | 22,603 |       2 |      0 |
| Python spawn workspace             |     29 |       0 |      0 |
| Virtual Bash runner controls       |    313 |       0 |      0 |
| Virtual Bash native unit suite     | 31,604 |      86 |      0 |
| SafeJS unit suite                  | 29,995 |      47 |      0 |
| Terminal Pilot native lifecycle    |    288 |       0 |      0 |
| Root posttest lint stress          |      2 |       0 |      0 |

The optional isolated just-bash comparator was unavailable and remains an explicit
pending observation, not a passed compatibility profile. Existing native-runtime
and opt-in skips remain skips. No task or profile was synthesized to improve the
count. Complete stdout/stderr is retained in `root-test.log`; SafeJS took 684.54s.

## Coverage map for the broader recovery contract

The full SafeJS gate above includes these maintained controls. Internal snapshot
composition is distinct from granting a foreign live realm access through the
public host boundary.

| Requirement                                                                                     | Maintained controls and disposition                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copied host data through bindings, registered modules, returns, callbacks, realms and migration | `transport-recovery-matrix.test.ts`: 156 cells; aliases/cycles, symbols, descriptors, extensibility and supported prototypes. `transport-rejection-matrix.test.ts`: 100 predictable-rejection cells.                                                                                                                      |
| Persistent realm authority and lifetime                                                         | `realm.test.ts`, `realm-callback-phases.test.ts`, `realm-owned-job-error.test.ts`: explicit grants, live identity, retained/revoked callbacks, foreign-object rejection, cleanup and cancellation.                                                                                                                        |
| Same/mixed-source closure ownership                                                             | `snapshot/mixed-realm-closures.test.ts`, `snapshot/mixed-source-closures.test.ts`: distinct original sources and realms survive repeated serialization, including class/private, async and generator state.                                                                                                               |
| Literal, template and intrinsic identity                                                        | `snapshot/mixed-realm-values.test.ts`, `snapshot/mixed-realm-intrinsics.test.ts`, `snapshot/template-identity.test.ts`: distinct realm graphs, literal prototypes, template sites and aliases; malformed realm IDs reject.                                                                                                |
| Dynamic eval and function globals                                                               | `snapshot/dynamic-source.test.ts`, `snapshot/eval-source.test.ts`, `snapshot/eval-source-validation.test.ts`: original dynamic source/environment and invalid source records.                                                                                                                                             |
| Classes/private elements and suspended frames                                                   | `snapshot/class-constructor.test.ts`, `snapshot/private-elements.test.ts`, `snapshot/async-function-continuations.test.ts`, `snapshot/async-function-live-capture.test.ts`, `snapshot/guest-generator-restore.test.ts`, `snapshot/async-generator-validation.test.ts`.                                                    |
| Native iterator state                                                                           | `snapshot/collection-iterators.test.ts`, `snapshot/regexp-iterators.test.ts`, `snapshot/typed-array-iterator-replay.test.ts`: cursor and identity recovery. Opaque host-native iterators retain their explicit admission rejection.                                                                                       |
| Errors and promises                                                                             | `host-error-identity.test.ts`, `snapshot/error-data.test.ts`, `run.public-promise-recovery.test.ts`, `run.pending-imported-promise-checkpoints.test.ts`, `run.promise-compatibility.test.ts`: identity, v6/v7/v8 compatibility and pending proof boundaries.                                                              |
| Temporal and shared/weak graphs                                                                 | The six-path matrix includes all implemented Temporal categories. `snapshot/weak-collection.test.ts`, `snapshot/weak-reference.test.ts` and `interp/shared-argument-graph-recovery.test.ts` cover modeled weak graphs and captured shared blocks. Native GC timing and uncaptured raw shared histories are not qualified. |
| Malformed/versioned input and allocation rejection                                              | `transport-version-matrix.test.ts`, `external-checkpoint-validation.test.ts`, `run.replay-input-allocation-budgets.test.ts`, `test/adversarial/snapshot-mutation.test.ts`: exact version envelopes and existing budgets.                                                                                                  |
| Transactional restore and cancellation                                                          | `snapshot/mixed-realm-intrinsics.test.ts` tests rollback after final reconciliation failure; `snapshot/atomic-wait-rollback.test.ts`, `interp/pending-proof-encoding-rollback.test.ts`, `run.pending-imported-promise-cancellation.test.ts` cover resource/proof cleanup.                                                 |
| Pending host-operation reconciliation                                                           | `interp/shared-argument-graph-recovery.test.ts` verifies reissue and external reconciliation without reissuing the resolved operation. Explicit host policy remains required; this does not promise exactly-once external effects.                                                                                        |

Paths above are relative to `packages/safe-js/src` except the named `test/` path.
The [fresh shared-history counterexample](shared-history-integrated-20260914.md)
is an acceptance failure despite these passes; it is not converted into a skip.

Repository-wide `npm run lint` passes ESLint, maintained type/contract checks and
`npm run lint:workflows`. `npm run smoke -- --prebuilt` passes every installed
CLI/SDK/declaration smoke, including the exact jobs-v9 snapshot expectation.
The full build/test/lint/smoke command exits0. Source hashes still match the
pre-gate receipt. The first Markdown formatting check reported two files; both
were formatted and checked again without changing executable QA assertions.

`npm run screenshot-poe-code -- --help` passes after its maintained uncached build.
The resulting full-height help screenshot was visually inspected: readable spacing,
consistent colors and no clipped commands. No CLI layout was changed. The PNG and
command log are retained locally with the gate receipts.
