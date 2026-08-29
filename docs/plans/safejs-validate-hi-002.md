# HI-002 independent validation

## Scope

- Validate Dalton's frozen four production files, author regression test, and author plan against initial wave `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`.
- Own only `packages/safejs/src/loader/markdown-offset-hi-002-validation.test.ts`, this plan, and `out/safejs-remediation/hi-002-validation/`.
- No production, README, master-plan, configuration, dependency, font, or Git mutations. No guest external IO, LLM calls, security testing, whole-unit-suite races, or new QA executables.

## Archive access

Before any original payload read, load only `inventory-verification.json#/archiveReadPolicy/excludedPaths`: exactly 38 paths plus the entire `security/` directory. An explicit six-file allowlist and guarded read ledger are recorded in `out/safejs-remediation/hi-002-validation/archive-access.json`. No original archive discovery, broad search, excluded-file hashing, or security payload reads.

The author's initial broad `rg` violated archive exclusions. That deviation remains in the frozen author plan; validation does not repeat, erase, or retroactively authorize it. The earlier screenshot-wrapper omission likewise remains historical; this validation separately runs the authorized full build and requested wrappers.

## Independent procedure

1. Read the allowed original Markdown, compute literal UTF-16 indices before runtime, and preserve byte-identical local evidence copies. Original `missingTotal` is 214–226, line 14, columns 56–68; runtime `throw Error(message)` is 151–171, line 14, columns 20–40.
2. Exercise current TypeScript SDK, standalone CLI, and example runner with memfs across LF, CRLF, CR, optional BOM, astral text, multiple blocks, and real autofixes. Do not use dist as the automated oracle.
3. Test the old newline-prefix projection as an explicitly reconstructed control, not a historical archived checkpoint. Verify actual CLI restore, structural hash equality, saved host-result replay without reinvocation, and rejection of changed executable code.
4. Run scoped tests and static checks, then the expressly authorized full build. Capture root help only as wrapper coverage because the root paired harness route cannot run inline Markdown. Capture actual standalone lint/runtime diagnostics through `npm run screenshot -- ...`; inspect PNGs visually.
5. If ready, capture exactly four production files, two tests, and two plans under the owned candidate directory, with SHA-256 manifest and initial-wave preimages. Compare frozen hashes before capture. Do not publish or mutate Git.

## Results

**READY for scoped HI-002 publication from the captured candidate bytes.** No HI-002 correctness blocker found. This is not a whole-repository test/release verdict or authorization to publish other lanes.

### Independent reproduction and compatibility

- The embedded test fixtures match the actual allowed original payloads by SHA-256: lint `6c6b218dd29114ec78440368636b46714dc115aafd255182a9028bb417b83f91`; runtime `a8793a788f6c486e402180c47971da2d65eaefb336e8dd5e3740275f65bcc484`. Literal indices were computed before running the current implementation.
- A separate in-memory `node --import tsx --input-type=module` comparison loaded the actual initial-wave `runner/run-harness.ts` from `git show 9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc:packages/safejs/src/runner/run-harness.ts`. TypeScript compilation only resolved imports to current dependency modules; no production file was replaced. That runner returned 156–168; the current TypeScript runner returned 214–226 on the byte-identical original reduction. Both returned 14:56–14:68. This is a historical-loader/current-dependency control, not a claim to have rerun the entire historical repository.
- The 38 new tests use actual SDK/CLI/example entry points, independent string-index and code-unit line counting, LF/CRLF/CR with and without BOM, astral prefix and same-line Unicode, first/middle/final blocks, SDK/CLI whole-body fallback, and actual two-block autofix writes in memfs. Prose containing identical fix-looking text remains unchanged.
- Completed-checkpoint tests use a deliberately reconstructed old newline-only prefix with the current runtime, not an archived old-version snapshot. Actual CLI `--restore` receives that serialized snapshot. A saved host result returns 42 without invoking a replacement host callback; a fresh run returns 901 and invokes it once. Old/current projected strings differ but their structural source hashes match. Prose edits restore; changed executable code fails the real source-hash guard before execution. This covers completed replay, not pending checkpoint migration or all historical runtime versions.
- Initial validation run: 55/61 passed, six failures came from expecting the example runner to print `14:20`. Inspection confirmed that it intentionally prints only the runtime message. The corrected tests still assert its actual runtime span, while requiring the standalone CLI's rendered location. This was a validator expectation correction, not product RED. The author's historical RED remains separately recorded in the frozen author plan.

### Exact commands and results

All commands ran from `/Users/kjopek/Workspace/poe-code-safejs-fixes`.

```sh
node_modules/.bin/vitest run packages/safejs/src/loader/markdown-offset-hi-002-validation.test.ts packages/safejs/src/loader/markdown-offset-hi-002.test.ts
```

PASS: 68/68 across two files, 2.03 s. The independent file has 38 tests; the author file has 30.

```sh
node_modules/.bin/vitest run packages/safejs/src/loader packages/safejs/src/runner/run-harness.test.ts packages/safejs/src/cli.test.ts packages/safejs/src/example-runner.test.ts packages/safejs/src/cli-entrypoint.test.ts packages/safejs/src/error/format.test.ts
node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
node_modules/.bin/eslint packages/safejs/src/loader/extract-block.ts packages/safejs/src/runner/run-harness.ts packages/safejs/src/cli.ts packages/safejs/src/example-runner.ts packages/safejs/src/loader/markdown-offset-hi-002.test.ts packages/safejs/src/loader/markdown-offset-hi-002-validation.test.ts
node_modules/.bin/prettier --check packages/safejs/src/loader/extract-block.ts packages/safejs/src/runner/run-harness.ts packages/safejs/src/cli.ts packages/safejs/src/example-runner.ts packages/safejs/src/loader/markdown-offset-hi-002.test.ts packages/safejs/src/loader/markdown-offset-hi-002-validation.test.ts
git diff --check -- packages/safejs/src/loader/extract-block.ts packages/safejs/src/runner/run-harness.ts packages/safejs/src/cli.ts packages/safejs/src/example-runner.ts
npm run build
```

PASS: scoped suite 261/261 across 11 files, 5.82 s; typecheck, ESLint, Prettier, and whitespace checks pass. Full root build exits 0: 67 successful tasks, then schema generation, root TypeScript, wrappers, and bundle complete. No whole SafeJS or whole-repository unit suite was run.

### Visual verification

```sh
npm run screenshot-poe-code -- --output out/safejs-remediation/hi-002-validation/root-help.png --help
npm run screenshot -- --output out/safejs-remediation/hi-002-validation/lint-diagnostic.png node_modules/.bin/tsx packages/safejs/src/cli.ts out/safejs-remediation/hi-002-validation/original-offset.md
npm run screenshot -- --output out/safejs-remediation/hi-002-validation/runtime-diagnostic.png node_modules/.bin/tsx packages/safejs/src/cli.ts out/safejs-remediation/hi-002-validation/original-runtime.md
```

All three screenshot wrappers exit 0 and their PNGs were opened with the image tool. Actual affected children exit 1 as expected: AS003 at 14:56, and `coordinate-stop` at 14:20 with source/caret. Raw CLI output and exact child commands are retained in `cli-captures.json`. The root wrapper's preparation build passes (67 tasks, 65 cached). Root help is readable but verifies only wrapper/CLI availability: `src/cli/commands/harness.ts` routes through `resolvePair`/`runHarnessPair`, not the inline Markdown loader. Absolute offsets are established by automated span assertions, not help or PNG pixels.

The existing renderer shows the astral icon as a missing-glyph box; the diagnostic text and location remain readable. Raw output retains the icon and automated UTF-16 span assertions pass. No fonts, renderer settings, dependencies, or configurations were manually changed. This visual limitation is disclosed, not repaired or presented as Unicode glyph coverage.

### Generated files and capture

The authorized build generated four untracked assets: `packages/terminal-pilot/assets/jetbrains-mono-400-italic.ttf`, `packages/terminal-pilot/assets/jetbrains-mono-400-normal.ttf`, `packages/terminal-pilot/assets/jetbrains-mono-700-italic.ttf`, and `packages/terminal-pilot/assets/jetbrains-mono-700-normal.ttf`. They are left untouched and excluded from the HI-002 candidate. Concurrent other-lane output was ignored. No other new tracked change appeared during this build window.

The candidate contains exactly eight publishable files: four production files, the author and validator tests, and the author and validator plans. `out/safejs-remediation/hi-002-validation/candidate/hash-manifest.json` records SHA-256, byte lengths, initial-wave preimages for the four tracked production files, explicit absent-at-base records for four additions, and frozen-author hashes. Candidate files and preimages are read-only; `candidate-verification.json` records the post-capture byte/hash verification. Use captured bytes, not a later mutable worktree. The original audit and all six frozen author files remain unchanged by this validator. No Git mutation or publication occurred.
