# Bare-interpreter RegExp hook qualification

Overall qualify-builtins acceptance remains open. This atomic repair addresses a new maintained-integration failure found while checking the Array length repair. Existing target editions, extension pins, supported runtimes and authority boundaries are unchanged.

## Reproduction and repair

The original failure is retained in `../array-length-20260913/package-tests.log` and `expanded.log`: `interpreter.test.ts` expected bare interpretation of a regex literal separator to split `abba` into `['a','a']`, but got `['abba']`. This is an interpreter integration regression; the normal SDK installs realm globals, while bare `interpret` deliberately supports literals without installing globals.

The existing dispatch assumed that the presence of context.getProperty meant a missing symbol hook had been removed from an initialized RegExp. The repair also checks explicit prototype ownership for branded regex values. It retains string coercion when a caller explicitly removes a hook or sets a null prototype. Bare literals continue to use the bounded sandbox matcher. No native arbitrary-pattern RegExp matching, host binding, proposal API, new abstraction or runtime support change was added.

`corrected-red.log` executes the final new test against the exact pre-repair string.ts bytes: one failed / three passed. `corrected-test.log` passes all four after repair. Earlier `red.log`, `focused.log` and `final-focused.log` contain two test setup mistakes (using the restricted parser facade, then importing a non-exported parseModule); they are not semantic evidence. The final test imports the maintained internal parser. The original maintained failure independently provided the pre-repair TDD counterexample throughout. No assertion was weakened.

`qualified-focused.log`: six files / 593 tests pass, zero skips, including 477 interpreter tests, 61 Array.from tests, the eight Array length regressions, four new bare-interpreter/hook controls, 25 created-RegExp-hook controls and 18 fatal hook-budget controls. The repaired Array path preserves numeric accounting. The repaired String path preserves explicit undefined/deleted symbol hooks and null-prototype coercion. `qualified-lint.log` records ESLint. Node18 results and exact versions are linked in the terminal receipt.

## Provenance and attempts

Base source is local `bf8bb1dd67cfbeba967d9bf1c7f2a9ea34d3c439` plus preserved dirty source and the Array repair. `../array-length-20260913/source-before.json` identifies input bytes, Node 22.23.2 / ICU 78.2, and the original staged diff. Each increment's `runtime.patch` isolates its own edits. The terminal corpus header and `receipt.json` identify final exact source closure and artifact hashes; historical results are not silently relabelled as current-source passes.

The initial `corpus.jsonl` attempt aborted during enumeration when the test source changed. `package-tests.log` is an interrupted early attempt while correcting test setup. Neither counts as a completed run. `qualified-corpus.jsonl` and `qualified-package-tests.log` contain the final attempts. The selected newer BigInt-primitive match fixture remains a known edition-16 mismatch (QB-MATCH-EDITION), not a request to remove the required primitive symbol-method lookup. Its failing modes must remain visible.

Reproduce from the repository root (fresh output path required):

```sh
node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/array-length-coercion.test.ts packages/safe-js/src/interp/globals/array-from.test.ts packages/safe-js/src/interp/interpreter.test.ts packages/safe-js/src/interp/methods/string-regexp-bare-interpreter.test.ts packages/safe-js/src/interp/methods/string-regexp-created-hooks.test.ts packages/safe-js/src/interp/regex/hook-cost-qualification.test.ts
npx eslint packages/safe-js/src/interp/interpreter.ts packages/safe-js/src/interp/array-length-coercion.test.ts packages/safe-js/src/interp/methods/string.ts packages/safe-js/src/interp/methods/string-regexp-bare-interpreter.test.ts
node --import tsx packages/safe-js/test/conformance/command.ts --corpus /tmp/safejs-regexp-test262-419d3e0 --include built-ins/Array/S15.4.5.2_A3_T2.js --include built-ins/Array/S15.4.5.2_A3_T1.js --include built-ins/String/prototype/match/cstm-matcher-on-bigint-primitive.js --include built-ins/String/prototype/match/cstm-matcher-is-null.js --report <fresh-report.jsonl>
npm run test:unit --workspace=@poe-code/safe-js
```

The final Array/String selection is complete: four files / eight variants, six passed, two failed, zero unsupported, exit 1. Both failures are the two modes of the unchanged QB-MATCH-EDITION fixture. All four Array variants and both null-hook String.match variants pass. `split-corpus.jsonl` independently adds four original pinned split fixtures / eight variants, all eight passed, zero failed/unsupported, exit 0. Its header records the exact argv for custom hook invocation, getter failure, null hook and ordinary RegExp separator cases. Both reports share exact source closure `fa3b583fe2e85fd0b2203ec0a5a8221e54fb810211c392aa686ccefb124b2de4` and default deadlines/budgets. No overlapping file selection is summed across historical corpus runs.

Node 18.20.8 / ICU 74.2 independently passes the twelve new tests, zero skips (`node18.log`); this is not exact-minimum or full-backend qualification. Edition-16 String.match step 2 is retained in the prior `specification-extracts.txt`: it performs GetMethod for any non-null/undefined input. That recorded algorithm continues to justify the named newer-fixture mismatch.

## Review and disposition

The changed condition invokes no additional guest getter or Proxy trap. Existing hooked dispatch still reads and calls the hook once; default and deleted-hook controls remain distinct. The matcher, compiler ownership, cancellation, snapshot version, native isolation and regex ceilings are unchanged; existing hook-budget tests pass. No CLI output changed, so no visual screenshot is claimed.

All 108 category rows and 255 focused links are reconciled in the preceding increment, with exact historical revisions and remaining per-variant blockers. Those results are reused, not rerun wholesale. QB-REVISION, QB-EDITION, QB-REVALIDATE, QB-MATRIX and the named Date/arguments/realm/RegExp failures remain open. The current task is not complete.

Local atomic commits, remote-main delivery and release publication are separate. No push was requested; no new remote-main or publication receipt is claimed. The final response identifies the local commits.

## Terminal maintained checks

Final maintained SafeJS unit gate: **1,397 files passed / two files skipped; 30,053 tests passed / 47 skipped / zero failures**, exit 0. Skips remain separately visible: one opt-in parse fuzz case, two unavailable native Math.f16round comparisons, 33 filesystem reference gaps, and eleven unavailable native Temporal.Instant cases. No unavailable case is counted as a pass. The selected maintained workspace build passes, including **eight built-import checks**, zero skips/failures. ESLint passes on all four edited/new source files. Exact commands and hashes are in the final receipt.
