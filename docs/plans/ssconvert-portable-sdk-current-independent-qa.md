# Portable SDK current independent QA

Scope: independent review of the current public XLSX snapshot boundary and shared command/SDK engine. This review changes only `packages/ssconvert/src/public-xlsx-current-independent.test.ts` and this procedure. Runtime, integration, exports, Git and Pandoc gate ownership remain with root. No native oracle runs, host fixture writes, README edits, pushes or publication are authorized by this procedure.

## Execute

1. Run `npx vitest run packages/ssconvert/src/public-xlsx-current-independent.test.ts` against the candidate worktree. These original in-memory fixtures use public package imports, with Vitest's maintained package aliases resolving source. They establish source behavior, not compiled-consumer delivery.
2. Check both 2006 and 2008 writer variants reject nested cell accessors without invoking them, reject sparse cell arrays, and preserve a literal Unicode/XML-sensitive value when reopened. Confirm successful positive controls accompany negative authority cases.
3. Check pre-aborted writer preserves the exact falsey cancellation reason before inspecting caller workbook accessors. Check zero text/output budgets reject without mutating caller data.
4. Check unknown exporter SDK rejection has `invalid-request`, exit status 1 and the exact captured diagnostic; CLI maps the same failure to status 1 and stderr. Confirm injected memfs read/write counters remain zero and the namespace is unchanged.
5. Check foreign workbook ownership is denied. Import an owned workbook, then ensure over-budget writer output never reaches the injected sink. Ensure excess streamed input never reaches the reader; the admitted positive-control read must remain the sole codec read. Dispose and confirm subsequent reads fail as disposed.
6. Run `npm run lint --workspace=@poe-code/ssconvert`. This maintained route includes source lint, runtime TypeScript, test TypeScript and strict public-consumer declarations.
7. After root builds, use direct `node --input-type=module` with imports only from `@poe-code/ssconvert` and in-memory values. Repeat the two edition round trips and nested-accessor rejection using `node:assert/strict`. Do not import private paths. This bypasses Vitest aliases and directly exercises public compiled ESM.
8. Root owns maintained workspace test/build closures, safe-bash integration, exact candidate Git identification, screenshots and any broader gates. Do not substitute this focused review for those gates.

## Executed evidence

- Focused tests: 6 passed, 0 failed, 0 skipped on final focused run. Both XLSX editions count separately. Final run duration 2.37s, test duration 272ms; these are observed runner timings, not performance qualification.
- Direct Node compiled public imports: two edition Unicode/XML-sensitive round trips and nested-accessor negative controls passed; accessor count remained zero.
- Initial review run: 4 passed, 2 failed because the reviewer expected result objects for preflight rejection and tried to export an unadmitted workbook. Inspection confirmed explicit current contracts; corrected cases now assert rejection and negative workbook ownership. These initial failures did not validate runtime defects.
- Maintained workspace lint: passed, exit status 0, including source ESLint and all three TypeScript routes.
- Runtime defects identified by this review: none in the measured cases. Root's preceding failing regression and snapshot fix are separate evidence.

## Remaining unverified cells

This focused review does not measure complete Gnumeric parity; dependency/plugin/locale matrix variants; unsupported spreadsheet features; arbitrary generated archives; browser runtime delivery; host realm attacks beyond rejected accessors; native differential oracles; cancellation during every compression/parser stage; cleanup rollback after external sink failure; Safe Bash original/checkpoint/replay; Pandoc gate; CLI screenshots; broad workspace tests; or repository-wide lint/build. Unavailable and unmeasured cells are unverified, not passes. There were no generated findings requiring a seed or minimized generated fixture.

## Follow-up coordinate preflight candidate

Reviewed on 2026-09-21 at 14:27:17 UTC. The inspected `packages/ssconvert/src/codecs/xlsx.ts` SHA-256 was `7ce7554ce066a10436626cf8fdac78319134f2d5cccf3297b56d26233f9e5e12`. This identifies the runtime bytes inspected rather than an unchanged Git revision.

Root added a descriptor-only coordinate preflight after the first review to preserve maintained unsupported-coordinate diagnostics. Independent follow-up controls cover sheet array index accessors, sheet `cells` accessors, cell array index accessors, exhausted work before sheet admission, and 100,000,000-length sparse sheet/cell arrays. All negative controls kept accessor invocation count at zero. Oversized arrays and exhausted work rejected with `resource-limit`; accessor-bearing admitted arrays rejected with `invalid-request`.

The expanded focused run passed 9 tests, 0 failed, 0 skipped (5.76s runner duration, 363ms test duration). No new runtime defect was reproduced. Previous compiled-consumer evidence belongs to the earlier candidate; root owns rerunning compiled consumer/browser/build gates after the preflight change. Follow-up maintained workspace lint passed with exit status 0 at 14:28 UTC, including source ESLint and all three TypeScript routes. Runtime SHA-256 remained unchanged when rechecked during lint.
