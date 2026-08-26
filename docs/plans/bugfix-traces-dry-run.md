# Traces dry-run bugfix

## Scope

- Change only `src/cli/commands/traces.ts`, its existing command test, and this plan.
- Respect leading/trailing global `--dry-run` and the `trace` alias before calling the trace viewer. Even plain listing can synchronize the discovery index.
- Preserve path/JSON compatibility validation and parse source, duration, and limit before returning a preview.
- Human previews use the existing scoped logger's `dryRun`; JSON previews use `writeJson` with `dryRun: true`, operation, and serializable parsed options, without human output.
- Human output names the operation: list traces, rebuild the listing index, display a trace path, export HTML with an optional destination, or open the exported HTML in a browser. It does not dump context, filesystem paths unrelated to the requested operation, or default booleans. Only requested sources, since, limit, and full-title settings appear through `logger.resolved`.
- Keep ordinary viewer delegation and its options unchanged. Do not add an SDK dry-run argument or change the viewer package.
- No dependencies, README changes, inline comments, staging, commits, pushes, or unrelated edits.

## Execution

1. Add failing regressions for global flag positions, alias, listing/path/HTML/browser/index modes, JSON previews, and validation parity.
2. Build validated options before previewing and return before viewer delegation on dry runs.
3. Confirm focused green, notify the parent, then run types and scoped lint checks.

## Validation And QA

- Tests use the actual registered command, memfs, an exact viewer SDK mock, and fail-closed prompt/command/HTTP dependencies. No file fixtures, network calls, or process spawning.
- Existing ordinary delegation tests cover parsed filters, dates, limits, yes, JSON, full titles, HTML, browser, and alias behavior.
- Parent already captured and inspected `screenshots/ux-traces-dry-run-before.png`; parent owns after-QA/screenshots and release.
- Other workers own viewer empty-JSON and runtime changes. Preserve those changes, manifests, security plan, and terminal assets.
- Baseline HEAD: `a64ce1cac3347eb883ab8ed382574b6bd5323343`.
- RED: `node_modules/.bin/vitest run src/cli/commands/traces-command.test.ts --reporter=dot` reported 24 failing dry-run regressions and 35 passing validation/delegation controls before the production edit. Every failure showed an unexpected viewer call.
- GREEN: the same focused command passes all 59 tests after the command-level early return (31 ms test execution). The parent was notified immediately, before extended checks, that the patch was safe for full-suite/after-QA work.
- `npm run lint:types`, scoped ESLint for both TypeScript files, Prettier checking this plan, and scoped `git diff --check` all pass.
- Parsed viewer options are shared by preview and ordinary delegation; the filesystem dependency is supplied only to the actual viewer. JSON omits undefined properties and serializes the parsed `since` date as an ISO timestamp.
- Boundaries: dry runs do not invoke the SDK, inspect trace contents, synchronize/rebuild indexes, write HTML, open a browser, or perform SDK-level path validation. Existing command-level validation remains active. No SDK API or package behavior changes; actual runtime/screenshots remain parent-owned.

## Human Preview Review

- Replaced the raw JSON human preview with inline operation-specific messages using the existing logger. The JSON branch, shared options, validation, and ordinary delegation remain unchanged.
- TDD refinement RED: the focused command reported 24 human-output failures and 41 passing controls, including the unchanged JSON/validation tests. After the human formatting edit, all 65 tests passed; all original 59 cases remain, with six added filter/path-rebuild controls across flag positions and alias.
- Source review confirmed the SDK bypasses index discovery for an explicit trace path. Tightening the three path/rebuild preview assertions produced 3 failures and 62 passes; restricting the rebuild message to listing restored all 65 tests to GREEN (33 ms test execution).
- Assertions check exact meaningful operation messages, requested parsed filter values, and absence of JSON/context dumps. No helpers, dependencies, or SDK changes were added. Parent notified immediately after final focused GREEN; parent owns after-QA and screenshots.

## Parent After-QA

- Parent reviewed and approved the human preview refinement and reported 10 passing actual public-CLI QA cases covering HTML export paths, alias/browser opening, trailing dry-run, rebuild with source/limit filters, path display, JSON rebuild and since/limit previews, and invalid-option validation controls.
- The exact viewer module mock recorded zero calls; memfs remained byte-for-byte unchanged. Human previews contained no JSON wall, and JSON previews contained no human intro.
- Parent captured and inspected `screenshots/ux-traces-dry-run-after.png` against `screenshots/ux-traces-dry-run-before.png`, confirming readable, concise operation lines.
- Final local validation is complete: all 65 focused command tests, global `npm run lint:types`, scoped ESLint for both TypeScript files, plan formatting, and scoped `git diff --check` pass. Parent owns staging, commit, and release; none were performed by this worker.
