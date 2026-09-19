# csvpy validation record

Recorded September 18, 2026. This is a scoped implementation record, not a full csvkit 2.2.0 compatibility qualification.

## Authenticated sources

- csvkit 2.2.0 PyPI source archive: SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b` verified before inspecting `utilities/csvpy.py` and `cli.py`.
- Frozen Agate 1.14.2 source archive: SHA-256 `7f29841c39d84b1de7fde762b8d792085371515324f3a01413b20f810398225b` verified before inspecting CSV reader and configuration implementations.
- Existing `reference-profile.json` remains the reference declaration. Source-derived assertions are not native interactive differential measurements.

## Passing checks

- Original csvpy regressions were observed failing before fixes: eager CSV field errors, filename-access ordering, module identity/configuration, SystemExit, output budgets, mutable DictReader properties, cooperative terminal cleanup and stdout preceding exception diagnostics.
- `npx vitest run packages/csvkit/src/csvpy.test.ts`: 12 tests passed after the final stdout-ordering fix.
- `npm test --workspace=@poe-code/csvkit`: 87 files, 4115 passed, 1 skipped, 6 todo. Skipped/todo cases are not passes.
- `npm test --workspace=@poe-code/safe-python -- src/session-object-bridge.test.ts src/session-interactive.test.ts src/session.test.ts --maxWorkers=1`: 27 tests passed on the final shared bridge.
- Selected parser/compiler/runtime checks passed earlier: 323 tests. The quarantined `runtime-program.test.ts` was not run and is not counted.
- Maintained `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: dependency closure completed successfully, 11 build tasks, including csvkit and safe-python.
- `npm run lint --workspace=@poe-code/csvkit`: ESLint, production types and test types passed after final adapter edits. Root lint passed earlier; root type lint and touched shared-interpreter ESLint passed after bridge changes. These are separate observations, not a final full-root gate.
- The independent stress agent's registered-shell suite passed all 11 cases after cleanup fixes. It uses memory inputs and maintained public APIs; it checks channels/status, argv omissions, stdin preservation, lazy reader parsing, DictReader properties and cancellation/cleanup.
- An ad hoc registered-console screenshot was generated and visually inspected for banner, prompts, guest reader representations and EOF. It is not a screenshot test or full interactive qualification.
- `git diff --check` passed. No staging, commit, push or publication was performed.

## Incomplete broad gates

The root `npm test` run was stopped after timeout failures and a stale regression while implementation was still changing. It did not pass. A mistaken safe-bash unit invocation did not select csvpy and was stopped after the runner's 536 tests passed; the remaining Bash tasks were not measured.

A single-worker retry of 16 safe-python files ended with 4058 passes and two 5000ms timeout failures: EUC-JIS-2004 strict triple splits block 6 and Johab strict Unicode encoding plane +0 block 14. An earlier retry had 4059 passes and another Johab timeout; that isolated case subsequently passed in 29ms. These timeouts remain validation blockers, not dismissed as unrelated or converted into passes. Timeouts were not increased.

## Compatibility blockers

See `../specs/csvpy.md` and `../specs/csvpy-python-bridge.md` for precise boundaries. Complete guest Agate Table/Row/Column/MappedSequence and Decimal/temporal libraries remain absent; table mode explicitly requires an injected object library. File decoding/transport is buffered, and live file timing remains unmatched. Reader dialect/library coverage, exact `code.interact` diagnostics/compiler state/display hooks and optional IPython remain unqualified. No complete native interactive differential measurement was performed. These gaps prevent claiming the requested literal compatibility is complete.

Task-specific temporary archives, logs and screenshot evidence under `out/csvpy-*` are purged after recording these outcomes. Maintained regression tests and QA procedures remain in the repository.
