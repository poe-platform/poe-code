# HI-002: Original Markdown diagnostic offsets

## Scope and baseline

- Worktree: `/Users/kjopek/Workspace/poe-code-safejs-fixes`; initial HEAD `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`.
- Only production ownership: `packages/safejs/src/loader/extract-block.ts`, `packages/safejs/src/runner/run-harness.ts`, `packages/safejs/src/cli.ts`, and `packages/safejs/src/example-runner.ts`.
- New regression file: `packages/safejs/src/loader/markdown-offset-hi-002.test.ts`.
- No edits to other lanes, parser, interpreter, lint, README, master plan, or original audit. No Git mutations or publication.
- Audit metadata establishes 38 excluded archive paths plus the entire `security/` directory. Bootstrap deviation: the initial broad `rg` mistakenly searched security payloads before establishing those exclusions. Those reads were not authorized; no payload was executed, modified, or used in the fix. Subsequent evidence reads are restricted to the master report and nonexcluded harness/editor/diagnostic families.

## Evidence and contract

- Historical evidence: sibling `poe-code/out/safejs-audit-2026-08-27/REPORT.md`, finding HI-002; `harness-integration/REPORT.md`; `parser-diagnostics-review/REVIEW.md`; `editor-runner-composition/REPORT.md`.
- Original `harness-integration/reductions/08-offset.md` has `missingTotal` at UTF-16 offsets 214–226, line 14, columns 56–68; historical SDK reports 156–168 with correct line/column.
- Independent runtime control `parser-diagnostics-review/controls/runtime-lf.md` places `throw Error(message)` at 151–171 (LF), 164–184 (CRLF), line 14, columns 20–40. The same-line astral literal must count as two UTF-16 units.
- `packages/safejs/MARKDOWN_SCRIPTS.md` explicitly preserves inter-block UTF-16 offsets and original Markdown lines. Leading-prefix absolute offsets are the inferred integration contract, not an invented quotation. Existing line/column and autofix behavior is already correct.

## Implementation plan

1. Reproduce the original nonzero-prefix offset discrepancy before production edits.
2. Preserve every leading-prefix UTF-16 unit and original CR/LF while masking non-code text, using the same mapping as inter-block gaps.
3. Apply the same source projection to SDK, CLI, and example runner; map fix ranges directly into original Markdown coordinates without double compensation.
4. Verify original anchors, LF/CRLF/CR, BOM, Unicode, multiple block locations, whole-body fallback, and actual in-memory autofixes.
5. Run focused and adjacent regressions, assess safe diagnostic screenshot applicability, and record actual results for independent validation.

## Validation

Tests use `memfs`; no guest external IO, LLM calls, unit filesystem writes, or new QA executables. All production/test changes used `apply_patch`.

### Actual RED/GREEN receipts

- RED, before production edits: `node_modules/.bin/vitest run packages/safejs/src/loader/markdown-offset-hi-002.test.ts` returned 17 failed / 12 passed in 1.72 s. Eleven failures demonstrated original-offset mismatches; six runtime cases initially had an incorrect test budget fixture (`budget.reset is not a function`). All 12 real autofix cases already passed.
- Isolated RED before production edits: the same command with `-t 'reproduces the original audit anchor'` failed on expected offsets 214–226 versus actual 156–168. Both expected and actual retained line 14, columns 56–68. No expectation was normalized to the broken offsets.
- After the source-mapping fix and correcting the runtime fixture to `new Budget({ maxSteps: 1000 })`, all initial 29 tests passed (1.47 s). Runtime LF/CRLF/CR and BOM variants now match their literal-string indices and original line/column.
- Added a thirtieth compatibility test for old newline-prefix snapshots. Two test-authoring assumptions were corrected: `runHarness` does not read a supplied snapshot backend to resume, so the test uses the actual CLI `--restore` path; `dump()` already returns serialized JSON, so the in-memory fixture must not stringify it again. These were test-fixture failures, not additional product findings or production changes.
- Final focused GREEN: `node_modules/.bin/vitest run packages/safejs/src/loader/markdown-offset-hi-002.test.ts` passed 30/30 (194 ms tests, 2.12 s total).
- Final adjacent regressions: `node_modules/.bin/vitest run packages/safejs/src/loader packages/safejs/src/runner/run-harness.test.ts packages/safejs/src/cli.test.ts packages/safejs/src/example-runner.test.ts packages/safejs/src/cli-entrypoint.test.ts packages/safejs/src/error/format.test.ts` passed 223/223 across 10 files (5.50 s total).
- `node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit` passed.
- `node_modules/.bin/eslint` and `node_modules/.bin/prettier --check` passed on all five changed TypeScript files; scoped `git diff --check` passed on the four production files. No root build was run.

### Implementation outcome

- `maskSource()` now shares exact UTF-16 whitespace projection between inter-block gaps and the leading Markdown/frontmatter prefix. CR and LF remain unchanged; astral characters contribute two spaces.
- SDK Markdown loading retains the BOM's original offset; existing raw `.ajs`/`.safejs` BOM handling and paired-script paths remain unchanged.
- CLI and example-runner fix ranges now use original document offsets. Their Markdown source compensation is zero, avoiding a second offset adjustment while preserving actual applied edits.
- Regression coverage includes the first, second, and third fences; whole-body fallback; current CLI/example diagnostics; original line/column; 12 actual multi-block autofix cases; cross-block fix exclusions in the existing suite; SDK hashbang behavior; and CLI restoration of an old-prefix snapshot.

### Manual diagnostic screenshots

- Inspected `src/cli/commands/harness.ts`, `packages/safejs/src/cli.ts`, and `scripts/screenshot.ts` before choosing a command. The root `poe-code harness run` only runs paired `.ajs` files, not the affected inline-Markdown loader. `screenshot-poe-code` also invokes a full root `predev` build, which is reserved for the publication lane.
- Attempted the same renderer through `npm run screenshot -- --output out/safejs-hi-002/lint-diagnostic.png node_modules/.bin/tsx packages/safejs/src/cli.ts ../poe-code/out/safejs-audit-2026-08-27/harness-integration/reductions/08-offset.md`; it failed because `terminal-png/dist/index.js` is not built. No dependency or root build was performed.
- Fallback manual capture used an ad-hoc `tsx -e` command importing the existing `packages/terminal-png/src/index.ts` renderer, not a new QA executable. It spawned the actual SafeJS CLI with a 10-second host timeout, no `--fix`, no filesystem/environment/MCP capabilities, and no agent or LLM launch.
- Captured the original allowed audit reduction `harness-integration/reductions/08-offset.md` (exit 1, AS003 at 14:56) and `parser-diagnostics-review/controls/runtime-lf.md` (exit 1, expected `coordinate-stop` at 14:20). Original audit files were read only.
- Viewed both generated PNGs with the image tool: `out/safejs-hi-002/lint-diagnostic.png` and `out/safejs-hi-002/runtime-diagnostic.png`. Matching raw output is retained in sibling `.txt` files. Paths, line numbers, messages, and the runtime caret are readable. The renderer displays the astral icon as a missing-glyph box; raw output retains the icon, and assertions verify its UTF-16 column.
- The exact requested `npm run screenshot-poe-code -- ...` wrapper was not used, for the routing/build reasons above. These are actual affected-CLI captures, not screenshot tests or proof of root pair-CLI changes.

## Handoff and remaining risks

- Implementation and local validation complete; independent validator and publication approval remain required. No commit, staging, branch, pull, push, or release action was taken.
- Only the four claimed production files, one new issue-specific test, this issue plan, and the four ad-hoc screenshot/output artifacts were written. Concurrent lane changes were left untouched.
- Leading-prefix scanning now retains the original prefix length instead of only newline count; work is linear in the Markdown prefix, matching existing inter-block projection. Raw-script offsets are intentionally not broadened by this fix.
- No whole-repository build or full SafeJS suite is claimed. Existing snapshots remain compatible in the tested CLI restore path; no broader checkpoint migration claim is made.
- Audit-read and screenshot-wrapper deviations are explicitly recorded above for coordinator review.
