# Current standalone inventory maintenance — 2026-08-28

**Metadata-only author patch, not build/type/runtime acceptance.** Observed base
`d5cdd3a3983c32fba8aa1d7d9a4a0d8917a47a45` has199 tracked `.mts` paths but192
classified entries. `scripts/typecheck-inputs.mjs:31` rejects the seven paths
below. `scripts/typecheck.mjs` calls admission before incrementing its build
counter or invoking TypeScript. This is a prebuild inventory failure, not seven
compiler diagnostics. Heisenberg's reported full command was not replayed or
relabeled; this review independently reproduced the census rejection through
the existing read-only inventory validator.

## Exact seven paths

| Path | Classification and retained coverage |
| --- | --- |
| `tests/commands/timeout-author-20260828/repair-f22-v1/capture-prepatch.mts` | Frozen source9ed9 prepatch diagnosis; rejected-candidate label, original failure and package32e2 retained. Not current execution. |
| `tests/commands/timeout-author-20260828/repair-f22-v1/types-positive.mts` | Frozen F22 source-local positive proof selected by its fixed-revision runner; sourcea238/packagee6f42/authentication retained. Current equivalent added separately with only the public import specifier changed. |
| `tests/commands/xan-module-review-20260828/actual-review-v2/compiler-control.mts` | Sealed synthetic compiler witness, not a product consumer; PRE-SEAL binds bytes. |
| `tests/commands/xan-module-review-20260828/actual-review-v2/compiler-fixtures/nested/value.mts` | Sealed synthetic nested-emission witness, bound by CONTINUATION-PRE rather than earlier PRE-SEAL. No compiler or XAN rerun. |
| `tests/commands/xan-module-review-20260828/actual-review-v2/consumer-negative.mts` | Sealed fixed-build private-leaf seven-diagnostic consumer; source0ec84/package324268 and exact input authenticated, not a current public or generic-nonzero negative route. |
| `tests/commands/xan-module-review-20260828/actual-review-v2/consumer-positive.mts` | Sealed fixed-build private-leaf positive consumer, same original source/package. XAN remains execution-held/unaccepted and is not scheduled by this patch. |
| `tests/fs/webdav/directory-access-author-20260828/public-types.mts` | Maintained unchanged root/subpath declarations plus four expected-error directives; explicit strict type-only group. Its top-level access promises are not executed as provider tests. |

The six frozen entries are specific version-bound recipes/witnesses, not a
directory exclusion or assertion waiver. All original seven bodies match
committed base bytes. XAN's failures, held execution and artifact-only88608b65
qualification are unaffected. No tool from its subtree is imported/executed.

## Minimal maintained patch

- `inventory.json`: retain all192 prior entries/metadata and append the seven
  classifications plus one maintained timeout counterpart. Existing validation
  authenticates frozen inputs and owning evidence hashes.
- `consumers.mjs`: add two strict type-only groups with empty runtime lists.
  No existing group, negative diagnostic or consumer body changes.
- `current-timeout-options.mts`: identical to the F22 options proof except
  `../../../../src/commands/timeout/index.js` becomes
  `virtual-bash/commands/timeout`. Scheduler, explicit undefined invoke and
  single/multiple/plugin factory assertions remain. The existing installed-
  package typing route enforces declaration/source-fallback binding; no new API.

Resulting census: **200 =153 frozen-evidence +36 current +7 declaration
+1 frozen-oracle +3 negative-types**. The new maintained counterpart explains
199→200. Root `.ts` inclusion, tsconfig, package/exports/defaults and typing
scripts are unchanged. No fixed76 profile, driver, classification manifest or
candidate changed; its192 census remains its historical binding.

## Bounded checks and pending validation

`check.mjs` ran15 metadata checks, with zero compiler/build/product/native/service
or XAN execution. `RESULTS.json` preserves the old census failure, seven inputs,
new roles/hashes and protected-file bindings. Its precommit census explicitly
adds the new maintained file: `newConsumerTrackedAtCheck:false` does not claim it
was already tracked.

Controls reject unknown neighbors, missing current input/compile routes, removed
frozen rows, altered frozen bytes/seals and a current→frozen role swap. Positive
checks cover unchanged192 entries, original seven Git bytes, timeout's sole
specifier delta and XAN original-versus-continuation seals. These are metadata
controls, not compiler/source-error mutants.

Actual strict compilation, expected-error directive checking and same-package
resolution remain pending an authorized build/type phase. No global command ran.
Different review should inspect the six frozen roles and current counterpart
before a new whole-product candidate adopts the maintenance.

Source96ed7733 is sealed separately. `POSTCOMMIT.json` reruns the same15 metadata
checks with the new counterpart now actually tracked; `ADMISSION.json` records
the actual `verifyTypecheckInputs` function passing with5 captured-data entries,
14 staged inputs,3 source-consumer groups and the200-entry census. It invokes no
compiler, build or product. The precommit result is preserved separately.

```sh
node tests/plugins/qualified-current-release/inventory-maintenance-20260828/check.mjs
```

Default invocation reads/checks and prints only. Explicit `--capture` requires a
fresh file in this directory; no historical evidence is overwritten, original
recipe launched or AGENTS copied.
