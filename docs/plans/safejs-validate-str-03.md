# Independent validation: STR-03 replacement substitution

## Decision and boundaries

- **STR-03 is ready for serialized clean-publisher review after approval. No author fix is required by this validation.** Nothing was committed, staged, pushed, published, reverted, or checked out.
- **Original workflow 06 remains FAIL**, not PASS: five token offsets still return undefined (STR-01 / ARRAYOWNMETADATA). Keep that defect in the global queue. This validation neither closes the full workflow nor claims the whole audit fixed.
- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-fixes`, branch `main`, base `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`.
- Validation observed August 28, 2026 local America/Chicago; evidence timestamp uses August 29 UTC. Runtime Node `v22.22.2`; current TypeScript source, never dist.
- Owned changes only: the new independent test, this document, and `out/safejs-remediation/str-03-validation/`. Frozen author files and all other lanes are untouched. No README/master-plan edits; no git mutations.
- Read ancestor/root AGENTS and checked scoped nested paths. This is the delegated independent STR-03 validation lane. Tests use in-memory fixtures, no disk writes, LLMs, guest host modules, network, filesystem, or process capabilities.
- No full suite while parallel lanes have RED tests. No visual CLI changes; screenshot checks do not apply.

## Archive boundary

Bootstrapped `/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27/inventory-verification.json` metadata before family payload reads; asserted 38 unique excluded paths and excluded the entire security directory. The retained exact exclusion-list SHA-256 is `31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13`. No excluded/security payload was opened, hashed, displayed, or executed. `out/safejs-remediation/str-03-validation/archive-boundary.json` records the exact list and permitted reads. Original audit files remained read-only; no broad archive traversal or security reading occurred.

## Root-semantics inspection

- `packages/safejs/src/interp/methods/string.ts:256` collects matches from the original input; replacement receives the unmodified `value` and original `match.index`, not accumulated result or copied-through offset.
- `packages/safejs/src/interp/methods/string.ts:273` scans the replacement once. Dollar escape and whole-match tokens consume two source characters; prefix/suffix tokens slice original UTF-16 context. Replacement text, captures, and inserted context are not recursively scanned.
- Numeric substitutions distinguish nonexistent groups (literal token), existing unset groups (empty text), and existing empty groups (empty text). Two digits are consumed only when valid; otherwise a valid one-digit group is used and the second digit stays literal. Zero-padded 01–09 work; 00 is literal; at most two digits address captures, so a hundredth capture is not addressable with `$100`.
- Literal search strings still delegate to native replacement; nonmatches return unchanged input; regex replace, global replace, and global replaceAll are covered. Callback output stays literal. The author's non-global replaceAll rejection control passes.
- The separate STR-01 mechanism remains visible: `packages/safejs/src/interp/methods/regex.ts:65` attaches match metadata, but `packages/safejs/src/interp/methods/array.ts:94` only exposes array indices/length/methods. Reading `match.index` inside workflow 06 still yields undefined. The STR-03 scanner receives internal match objects and therefore has correct offsets without repairing that guest array-read defect.

## Actual original executions

The unchanged original workflow (not the author's narrowed replacement-only integration) and both original reductions each ran once natively and twice against current SafeJS in fresh children. Native runs precede SafeJS runs. All nine children exited 0, without stderr, host timeout, or signal. Return values repeat exactly; SafeJS steps: workflow **619**, captures reduction **32**, context reduction **22**.

Bounds: native heap 128 MiB and VM timeout 1500 ms; SafeJS heap 192 MiB, maxSteps 150000, maxCallDepth 48, deadline 2500 ms, stringLength 32768, arrayLength 4096, dataSize 2097152; every child host timeout 10000 ms with SIGKILL. `modules: {}`, no guest bindings. No archived resource-limit probes were run.

| Original source | SHA-256 | Result |
| --- | --- | --- |
| strings/examples/06-template-replacement-unicode.safejs | `d211632dfa16b9865d63699e8d1a4b47bd793f813447854173fd909b2fa2972b` | STR-03 scope matches; full workflow FAIL on five STR-01 offsets |
| strings/reductions/r03-replacement-captures.safejs | `28339e68c01d96468e9f825b0f7e5ef700fea39916b2aed206f728cfdb26365c` | Complete native equality, repeated |
| strings/reductions/r04-replacement-context.safejs | `f5ebff2b937e8672a8042a0d367f4927c26779e394989d30fabece0f1e434ddc` | Complete native equality, repeated |

### Complete expected/actual outputs

`out/safejs-remediation/str-03-validation/original-comparison.json` retains **both complete original workflow return values**, every scoped expected/actual field, and an exhaustive full-output diff. `out/safejs-remediation/str-03-validation/original-runs.json` retains exact original source text, hashes, command argv, child outcomes, complete native/current/repeat outputs, and undefined-value paths. No token collection, code-point calculation, normalization, split, raw-template path, or returned field was removed from the executed workflow.

All **30 non-token top-level field comparisons** match (10 fields × 3 fixtures): captures, rendered, annotated, prefixViews, suffixViews, codePoints, normalized, pieces, literalReplacement, sourceTemplate. Token names/fallbacks/raw text and counts also match. Fifteen manually anchored replacement strings and five native token offsets prevent a vacuous native oracle; both reductions also have explicit complete expected anchors.

These are the **only full-workflow differences**, retained as unresolved defects rather than hidden by projection:

| JSON pointer | Expected native | Actual SafeJS |
| --- | --- | --- |
| `/0/tokens/0/offset` | 2 | undefined (omitted in JSON) |
| `/0/tokens/1/offset` | 13 | undefined (omitted in JSON) |
| `/1/tokens/0/offset` | 0 | undefined (omitted in JSON) |
| `/1/tokens/1/offset` | 9 | undefined (omitted in JSON) |
| `/1/tokens/2/offset` | 18 | undefined (omitted in JSON) |

Callback capture offsets independently remain correct: first fixture 2, 13; second 0, 9, 18. Fixture 3's complete return value matches.

Capture reduction expected = actual:

```json
{
  "missingOptional": "<>",
  "presentOptional": "<b>",
  "nonexistent": "<$2>",
  "fallbackTwoDigit": "<a0>",
  "zeroPaddedCapture": "<a>",
  "escapedDollar": "$:a:a"
}
```

Context reduction expected = actual:

```json
{
  "regexPrefix": "aac",
  "regexSuffix": "acc",
  "literalPrefix": "aac",
  "globalContext": "a[a|b2c]b[a1b|c]c"
}
```

## Independent regression tests and RED/GREEN

`packages/safejs/src/interp/methods/string-replacement-validation.test.ts` adds 63 tests. The original workflow and reductions are embedded unchanged, so tests do not depend on archive availability or read disk fixtures. The workflow test explicitly asserts replacement/control fields, not a false whole-workflow PASS or the incorrect STR-01 behavior.

The numeric matrix enumerates 00–99 plus 21 boundaries/adjacencies/unknown tokens, for ten capture layouts across all three regex routes. Layouts include no captures, one, unset, empty, nine, ten, unset tenth, twelve, ninety-nine, and one hundred groups. Explicit native anchors supplement the matrix. Additional tests cover dollar/whole-match/context, UTF-16 prefixes, global original-input reuse, no rescanning, zero-width matches, empty/literal replacement, nonmatches, literal search controls, and callback results.

TDD validation is read-only against production: Vite's in-memory transform substitutes only `git show HEAD:packages/safejs/src/interp/methods/string.ts`. The new independent tests fail **36/63**, with 27 controls passing; the transform applies exactly once. Frozen on-disk production remains unchanged. Removing that transform yields 161/161 author+validator tests; relevant broad tests yield 238/238. No failing baseline assertions are misclassified as current regressions.

## Exact validation commands and outcomes

All commands run from `/Users/kjopek/Workspace/poe-code-safejs-fixes`. Full stdout/stderr and argv are retained in `out/safejs-remediation/str-03-validation/command-results.json`.

### independent-baseline-red

```sh
node --input-type=module -e 'import {startVitest} from '\''vitest/node'\''; import {execFileSync} from '\''node:child_process'\''; import {resolve} from '\''node:path'\''; const target='\''packages/safejs/src/interp/methods/string.ts'\''; const original=execFileSync('\''git'\'',['\''show'\'','\''HEAD:'\''+target],{encoding:'\''utf8'\''}); let transformed=0; const context=await startVitest('\''test'\'',['\''packages/safejs/src/interp/methods/string-replacement-validation.test.ts'\''],{run:true,watch:false,reporters:['\''dot'\'']},{plugins:[{name:'\''str-03-read-only-baseline'\'',enforce:'\''pre'\'',transform(code,id){if(id.split('\''?'\'')[0]===resolve(target)){transformed++;return {code:original,map:null};}}}]}); console.log('\''BASELINE_TRANSFORM_COUNT='\''+transformed); await context.close(); if(transformed!==1)throw Error('\''Baseline transform did not apply exactly once'\'');'
```

Exit 1. Expected RED: 36 failed, 27 passed, 63 total; exactly one in-memory source transform.

### focused-green

```sh
node_modules/.bin/vitest run packages/safejs/src/interp/methods/string-replacement-validation.test.ts packages/safejs/src/interp/methods/string-replacement.test.ts --reporter=dot
```

Exit 0. 161 passed in 2 files (1.18 s Vitest duration).

### relevant-broad

```sh
node_modules/.bin/vitest run packages/safejs/src/interp/methods/string-replacement-validation.test.ts packages/safejs/src/interp/methods/string-replacement.test.ts packages/safejs/src/interp/methods/string.test.ts packages/safejs/src/interp/methods/regex.test.ts packages/safejs/src/interp/regex/engine.test.ts packages/safejs/src/interp/regex/parse.test.ts --reporter=dot
```

Exit 0. 238 passed in 6 files (1.64 s Vitest duration).

### production-typecheck

```sh
node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
```

Exit 0. Passed; no diagnostics except the formatter success message.

### focused-test-typecheck

```sh
node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safejs/src/interp/methods/string-replacement-validation.test.ts packages/safejs/src/interp/methods/string-replacement.test.ts
```

Exit 0. Passed; no diagnostics except the formatter success message.

### scoped-eslint

```sh
node_modules/.bin/eslint packages/safejs/src/interp/methods/string-replacement-validation.test.ts packages/safejs/src/interp/methods/string.ts packages/safejs/src/interp/methods/string-replacement.test.ts
```

Exit 0. Passed; no diagnostics except the formatter success message.

### validator-prettier

```sh
node_modules/.bin/prettier --check packages/safejs/src/interp/methods/string-replacement-validation.test.ts
```

Exit 0. Passed; no diagnostics except the formatter success message.

### scoped-diff-check

```sh
git diff --check -- packages/safejs/src/interp/methods/string-replacement-validation.test.ts packages/safejs/src/interp/methods/string.ts
```

Exit 0. Passed; no diagnostics except the formatter success message.


### Native and current-source original probes

The exact native and SafeJS `node -e` argv is recorded per invocation in `original-runs.json` (and separately in `policy-runs.json`). The matching record's `source` is passed verbatim to stdin; host spawning uses encoding utf8, timeout 10000, killSignal SIGKILL, maxBuffer 1048576. This avoids an executable QA runner: the QA procedure is this Markdown document; executions were ad hoc inline host commands. Current-source driver imports `./packages/safejs/src/run.ts` and `./packages/safejs/src/interp/budget.ts` with `--import tsx`.

## Existing policy variants (separate)

Six permitted original c01–c06 sources ran in another 12 isolated children, native then SafeJS, all exit 0/no stderr/no timeout. All six native runs succeed; all six SafeJS outcomes remain **expected rejections**, not STR-03 failures and not unsupported-feature support claims:

| Control | SafeJS outcome |
| --- | --- |
| strings/reductions/c01-marked-lookaround.safejs | ParseError: Lookahead is not supported at line 3, column 95. |
| strings/reductions/c02-marked-backreference.safejs | ParseError: Backreferences are not supported at line 2, column 75. |
| strings/reductions/c03-named-group.safejs | SyntaxError: Named groups are not supported at position 0 |
| strings/reductions/c04-minimatch-unicode-property.safejs | SyntaxError: Unsupported regex flag 'u' at position 0 |
| strings/reductions/c05-unicode-flag.safejs | ParseError: Unsupported regex flag 'u' at line 1, column 39. |
| strings/reductions/c06-sticky-flag.safejs | ParseError: Unsupported regex flag 'y' at line 1, column 25. |

c04 stops at the unsupported u flag; it is not evidence of independently reaching the property parser. These policy results are retained separately in `out/safejs-remediation/str-03-validation/policy-runs.json`. Archived c07–c09 and the entire security directory are excluded. STR-02, STR-04, and STR-05 are not repaired or closed by this lane.

## Frozen author file hashes

Before and after validation SHA-256 values are identical:

| File | Before = after SHA-256 |
| --- | --- |
| `packages/safejs/src/interp/methods/string.ts` | `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b` |
| `packages/safejs/src/interp/methods/string-replacement.test.ts` | `e4e313b14a9abe118327740a9c9a4d86e9d511d9c6a542016ac952867f9b7e8d` |
| `docs/plans/safejs-fix-str-03.md` | `a8056bfe6ba48eaeb6976c5923bdbf754060f323cf0795de0017d9eabaa64118` |

## Publication handoff

- Replacement substitution: scoped independent validation complete; no detected regression requiring an author correction.
- Whole original workflow / global audit: **not ready to claim fixed**; STR-01 / ARRAYOWNMETADATA remains in the queue with the five exact differences above.
- Release/publication: not performed or authorized by this validation. A serialized clean publisher must obtain approval, review the exact selected files/hashes, preserve other lanes, perform the appropriate integrated gates, and monitor any eventual release to success.

## Retained-evidence integrity check

A final inline Node assertion command exits 0: 38 exact exclusions, all 21 original/policy child outcomes, all retained source hashes, byte-identical workflow/reduction strings embedded in the independent test (checked through the TypeScript AST), 30 scoped matches, exactly five retained STR-01 differences, and unchanged frozen author hashes. Its exact argv/output is in `command-results.json` under `retained-evidence-integrity`.

Each of the eight new files also runs `git diff --no-index --check /dev/null <path>`; each exits 1 for the expected new-file difference and emits no whitespace diagnostics. These exact paths/commands/outcomes are recorded separately. The earlier scoped tracked-file `git diff --check` exits 0; it does not inspect untracked files.
