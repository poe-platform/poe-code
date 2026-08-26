# Empty trace-list JSON bugfix

## Scope

- Move the existing JSON-list serialization branch before the empty-reference guard in `packages/agent-trace-viewer/src/run.ts`.
- JSON listing must emit `[]\n` for both genuinely empty discovery and source-filtered empty results. Do not emit the human-friendly empty message in JSON mode.
- Preserve nonempty JSON arrays, title truncation, full-title output, path-detail JSON, and non-JSON friendly empty output.
- Change only `run.ts`, its existing tests, and this plan. No dependencies, new helpers, inline comments, README edits, staging, commits, pushes, or unrelated changes.

## Execution

1. Inspect the runner, real loader, and existing reader mocks/memory fixtures.
2. Add red empty-JSON tests, including full-title and source-filtered cases plus a non-JSON control.
3. Move the existing JSON branch without changing serialization or discovery logic.
4. Run focused and full-package tests plus appropriate lint/type checks; record red-to-green evidence.

## QA And Evidence

- The parent captured and inspected `screenshots/ux-traces-empty-json-before.png`. The parent owns after-QA, screenshots, review, and publication.
- Regressions call the actual runner and loader using existing reader mocks, memfs, and memory output. No filesystem fixtures, network, LLM calls, or new helpers.
- Existing nonempty JSON, title truncation/fullTitles, path-detail JSON, and human-readable output tests remain the controls.
- Preserve unrelated manifests, security plan, terminal assets, and disjoint runtime/CLI work.
- Red before production edits: the runner suite reported 3 failing JSON regressions and 19 passing controls. Both empty full-title modes and source-filtered JSON emitted `No traces found\n` instead of `[]\n`.
- Focused green: `node_modules/.bin/vitest run packages/agent-trace-viewer/src/run.test.ts --reporter=dot` passes all 22 tests after the branch reorder.
- Full-package green: `npm run test --workspace=@poe-code/agent-trace-viewer -- --reporter=dot` passes all 79 tests in 8 files, including the final rerun after tightening the new reader fixture's return type.
- Targeted ESLint for both changed TypeScript files, `tsc -p packages/agent-trace-viewer/tsconfig.json --noEmit`, and `git diff --check` pass.
- An additional standalone strict typecheck of the existing test file reports 36 diagnostics. A TypeScript compiler-host comparison using HEAD and current test contents entirely in memory confirms identical diagnostics, with no new diagnostics from this patch. Existing test-fixture typing remains unchanged; no files were written or reverted by that comparison.
- Parent after-QA passed on this patch: the actual registered CLI and source viewer, with mocked empty discovery, memfs, and captured stdout, emitted exactly `[]\n` for `traces --json`, alias `trace --json --source codex`, and full-title mode. Each parsed as an array, with no human logs, prompts, or volume mutations.
- The parent captured and inspected `screenshots/ux-traces-empty-json-after.png` alongside the before screenshot, labeled actual integration with mocked discovery. No parent QA files were edited by this task.
- Production changes only reorder the existing JSON and empty-reference branches. No new helpers, dependencies, inline comments, README changes, staging, commits, pushes, or unrelated edits were made.
