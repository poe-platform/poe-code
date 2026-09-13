# Eval syntax diagnostics: isolated delivery audit

Status: lexical/source-text acceptance remains open. This repair addresses eval parse-error source spans and excerpts; it does not claim full language or source-origin compatibility.

Target: published ECMA-262 edition 16 (June 2025), ECMA-402 edition 12, Test262 revision `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, and the evidence ledger's separately tracked newer APIs. The edition HTML web reader failed its content-size limit; the retained edition-16 document and existing target pin were used, not the floating draft.

Initial shared HEAD: `bc6107ba5a308e94335f2d419d51d122ed17e6c3`. Fetch found remote main `bfdd5353120a48dd1a4157241c2aeabf9154c1f6`. A detached worktree at that remote commit isolates this delivery from concurrent local/staged changes. No branch, reset, stash, force-push or blanket staging is used. Shared staged-patch SHA-256 before/after implementation: `839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`.

Runtime: Node 22.23.2, ICU 78.2, Unicode 17.0, V8 12.4.254.21-node.56, Darwin arm64. Dependency installation is reused through a node_modules symlink; this is not a clean-install certification.

## Confirmed failure and repair

`run('return eval("const x=)")', {filename:'guest/main.ajs'})` previously attached the outer call span to an inner SyntaxError. Direct `parseEvalScript` discarded all positions and retained a native host stack. Five negative cases (LF, CR, CRLF, LS, PS after an astral Unicode comment) failed before the repair; five valid neighboring cases passed.

The parser now creates a native SyntaxError with a sanitized stack and the original eval span/excerpt. A private WeakMap admits only parser-created diagnostics through error conversion. Ordinary host errors cannot supply trusted filenames, source text, spans or stacks. `<eval>` identifies the evaluated text; it is not a claim that the caller's filename or nested eval provenance is known. SyntaxError identity, catch behavior, direct/indirect eval values and CLI runtime exit code 1 are preserved. Formatting uses the evaluated excerpt rather than the outer program. Caught-error dump/replay retains these diagnostics.

Isolated testing exposed two prerequisites already present in the mixed working tree: source-offset calculation recognized only LF, and excerpt splitting omitted LS/PS. The isolated candidate reproduced three failing span cases, then two failing excerpt cases, before adopting only the relevant line-scanning/position hunks and `error/source-lines.ts`. Other pending formatter, tokenizer, module and CLI changes are excluded. No parser acceptance rule, timeout, assertion, supported runtime, budget limit or host grant is weakened.

The new regression file has 13 tests, including a forged-host-metadata negative control, caught-error replay, fatal source-budget rejection, and direct/indirect eval positive controls. An initial control used the wrong cleanup method (`dispose` rather than `release`); that test setup error was corrected. The first metadata copy attempted to overwrite a nonwritable span and failed five cases; separating diagnostic text from span attachment corrected it. TypeScript initially detected a widened `kind` property; the diagnostic now has the explicit existing ParseDiagnostic type.

## Reproduction and checks

Run from the isolated candidate checkout:

```sh
npm run pretest --workspace=@poe-code/safe-js
npx vitest run packages/safe-js/src/parse/eval-syntax-positions.test.ts
npx vitest run packages/safe-js/src/parse packages/safe-js/src/lint packages/safe-js/src/error packages/safe-js/src/interp/exceptions.test.ts packages/safe-js/src/interp/source-exceptions packages/safe-js/src/interp/reference-error-stack.test.ts packages/safe-js/src/interp/globals/eval packages/safe-js/src/snapshot/eval packages/safe-js/src/snapshot/dynamic
npx tsc --noEmit -p packages/safe-js/tsconfig.json
npx eslint packages/safe-js/src/error/shape.ts packages/safe-js/src/error/source-lines.ts packages/safe-js/src/interp/exceptions.ts packages/safe-js/src/parse/format-error.ts packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/syntax-diagnostic.ts packages/safe-js/src/parse/eval-syntax-positions.test.ts
npx tsx packages/safe-js/test/conformance/command.ts --corpus /private/tmp/safejs-baseline-test262-419d3e0 --report /tmp/lexical-eval-corpus.jsonl --include language/identifiers --include language/source-text --include language/literals --include language/asi --include language/comments --include language/line-terminators --include language/white-space --include language/keywords --include language/future-reserved-words --include language/reserved-words --include language/expressions/template-literal
```

Focused integration: **2,931 passed / one declared opt-in parser-fuzz skip**, 167 passing files / one skipped, exit 0, 52.51 seconds. Package no-emit TypeScript passes. Exact candidate bytes for all seven changed source/test files passed the unchanged repository ESLint configuration with zero errors/warnings using ESLint.lintText and their original repository filePaths (avoids confusing reused dependencies with checkout source). No lint rule was changed. Generated Intl data and all four filesystem type-contract cells passed through maintained pretest. These focused checks do not claim a full repository unit gate.

## Separate grammar outcomes

`grammar.json` records 37 exact source strings. Script parsing uses `parseEvalScript`; public Agent Script embedding uses `parseExecutableModule`; lint is recorded independently. Native `vm.Script` agrees with all 37 Script acceptance decisions. Native `vm.SourceTextModule` is only a module-grammar oracle, run with `node --experimental-vm-modules --import tsx`; it is not evidence of SafeJS module execution. The isolated committed runner explicitly reports module variants unsupported. The mixed working tree's uncommitted source-module resolver/parser is not silently included. Top-level return/await/export and strict contextual words are therefore not conflated across grammars.

## Manual visual QA

1. Write `return eval("\nconst x=)")` to a temporary `.ajs` fixture.
2. Run `npx tsx scripts/screenshot.ts --output /tmp/eval-invalid.png npx tsx packages/safe-js/src/cli.ts <fixture.ajs>`.
3. Inspect the image: `<eval>:2:9`, the original second line `const x=)`, and a caret under `)` are shown. No host frame or outer-source excerpt is displayed; exit code is 1. This was executed and the retained `eval-invalid.png` inspected. The command line contains the explicitly supplied fixture path; that is not an error-stack disclosure.

## Remaining acceptance work

Function constructor wrapper offsets, eval runtime-error filenames/caller identity, imported runtime-error origins, and restored executable-source origin identity remain unresolved. The historical mixed-tree corpus and its 44 exhaustive-fixture timeouts are not a certification of this isolated candidate. Current corpus outcomes and delivery receipts are recorded separately in the ledger and adjacent summary. No unsupported module/host capability is relabeled as an ECMAScript lexical defect. The remaining fixes require their own regressions, unchanged-deadline corpus qualification, supported-runtime and installed-artifact checks. No associated GitHub issue was supplied.
