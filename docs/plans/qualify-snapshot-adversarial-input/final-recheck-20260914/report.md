# Snapshot adversarial input: Map capability path recheck

Source anchor: `d047e615a69ab8e2644f00230ec310410eb57077`, plus the preserved existing working changes. Node **22.23.2**, ICU **78.2**, Darwin arm64. `source-before.json` records runtime versions and source hashes. This is working-tree qualification, not qualification of a clean checkout of the anchor.

The target remains ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93` and the ledger's separately pinned newer APIs. No compatibility or authority requirement changed.

## Reproduced defect and repair

`prepareReplayInputs` parsed a Map capability component with `const [kind, ordinal] = key.split(":")`. Extra components were discarded: `value:0:forged` resolved exactly as `value:0`. SNAP-ADV-MAP-PATH is malformed identifier acceptance, not a demonstrated privilege escalation: the resolved capability was explicitly present in the supplied Map and no capability was executed by the probe.

The initial regression has two failing rejection cases and two passing identity controls. Expanded pre-repair regression independently tests `key` and `value` against suffixes `:`, `:forged`, and `:0:properties`: **six failures, two passes**, 14ms test time. `map-red.log` and `map-red-expanded.log` retain these expected failures. The repair requires exactly two components and retains the existing kind, canonical integer and range checks. Canonical Map key/value identifiers preserve exact identity. Rejected paths invoke neither the capability-restored notification nor the capability operation.

The eight deterministic tests build graphs in memory, without files, timers, GC, or model calls. No abstraction or proxy function was added. Review of the three-line runtime change found no new ownership, cancellation or budget behavior: rejection occurs during existing validation, before graph commit and preparation callbacks. No wire version changes are needed because the encoder already emits exactly two Map path components. The successful legacy and current records are rerun in the broad selection.

## Audit coverage and commands

The [existing public entrypoint inventory](../audit.md) and [transaction recheck](../current-recheck-20260914/report.md) remain applicable. This recheck read public export routing, migration validation, replay graph decoding/commit/rollback and capability-path parsing, and revisited the atomic-wait/finalization rollback controls. The complete snapshot selection exercises private slots/prototypes, identity/cycles, unsupported versions, source hashes, bounded mutations, oversized data, weak cleanup, intrinsic/accounting rollback and Promise table rollback. Public restore/migration, memfs file migration, host journal/Promise replay, external checkpoint, crash/resume and agent-harness loader suites are included in `command.txt`.

The unchanged bounded corpus uses seed `0x5a902026`, 96 cases, 750ms corpus cap and 2s test timeout. Existing explicit dump-v1/v2 cyclic graphs, jobs-v6–v9 resume records and jobs-v1–v9 migration fixtures are retained. Internal resolver/scheduler hooks still constitute explicitly supplied trusted integration authority; arbitrary external effects in these hooks are not claimed to be reversible. Engine-owned rollback and guest provider activation are separately exercised.

Commands from repository root:

```sh
npx vitest run packages/safe-js/src/snapshot/replay-map-capability-path.test.ts
npx vitest run packages/safe-js/src/snapshot/replay-map-capability-path.test.ts packages/safe-js/src/snapshot/replay-inputs.test.ts packages/safe-js/src/snapshot/replay-capability-validation-qualification.test.ts packages/safe-js/src/snapshot/replay-transaction-qualification.test.ts packages/safe-js/src/run.replay-input-allocation-budgets.test.ts
npx tsc -p packages/safe-js/tsconfig.json --noEmit
npx eslint packages/safe-js/src/snapshot/replay-inputs.ts packages/safe-js/src/snapshot/replay-map-capability-path.test.ts
```

`command.txt` retains the exact broad command, run before and after repair. Baseline: **2,640 passed / 193 files**, zero failures/skips, 107.02s. The new test file was added after baseline discovery and was not counted in that baseline. Focused post-repair: **36 passed / five files**, zero failures/skips, 4.72s. TypeScript and scoped ESLint exit 0. Final broad results and preservation receipts follow below.

## Disposition and delivery limits

This increment repairs one validated parser defect. It does not close the previously documented independently executed Bun/Workerd, clean delivered-source and publication gaps. Full root/package suites and installed-artifact qualification were not run for this focused repair. CLI presentation did not change; no screenshot is claimed. No timeout, budget, assertion or supported runtime was weakened.

Local commit, remote-main delivery and release are separate: this increment is prepared as one atomic local repair commit. No push was requested or performed, and no release receipt exists for it. Overall released-runtime qualification remains open; local Node passes must not be reported as full completion.

## Final verification

Final expanded selection: **2,648 passed in 194 files**, zero failures, zero skips and zero unhandled errors, 126.69s. `final-exit.json` records exit 0; `final-acceptance.log.gz` retains the complete output. `source-tested.json` records source overrides/additions against the initial manifest. All other pre-existing SafeJS files and the unrelated staged patch are unchanged (`preservation.json`).

Logs are losslessly archived as `.log.gz`; `log-receipts.json` records original hashes. Read with `gzip -dc <name>.log.gz`. The small review found no further test-supported simplification; runtime code adds only the missing component-count check. The unresolved runtime/delivery cells above still block overall closure.
