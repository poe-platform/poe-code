# Legacy text importer verification

Verified September 20, 2026 against Gnumeric 1.12.61. The official archive SHA-256 is `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`; seven inspected plugin source/descriptor files matched the authenticated archive. Primary source remains under `out`, never in the product. [Reference profile](legacy-text-reference-profile.json) records locale, dependency versions, plugin/library hashes, registry and font metrics. [Native evidence](legacy-text-native-evidence.json) preserves assessed comparisons and independent native inputs/documents.

## Implementation and regression coverage

Distinct read-only providers are `Gnumeric_applix:applix`, `Gnumeric_oleo:oleo` and `Gnumeric_sc:sc`. Applix uses the released content signature and priority 100; Oleo has no content probe and uses filename detection at priority 100; SC uses the exact released signature at priority 51. Frozen registry entries supply no writers. SDK and virtual command use the same ssconvert engine with injected byte I/O and cancellation.

Missing-reader regressions failed before implementation for all three IDs. Original in-memory fixtures cover values, supplied caches and explicit recalculation, strings/escaping, formulas translated through workbook AST, provider reference conventions, sheet/dimension growth, names, styles, axes/views, metadata, malformed/unsupported records, bounds and already-cancelled imports. SC commands including `exec` and `system` remain workbook data. Memfs integration checks compare SDK/command results and namespace effects. No unit test invokes the native oracle, writes fixture files or queries an LLM.

A different agent completed the required stress/fix review with 28 independent cases. Repairs followed concrete failing regressions and native observations; detailed findings are in [the independent QA record](../plans/ssconvert-legacy-text-independent-qa.md). The two legacy test files contain 39 cases combined. Twenty-three independent native fixture imports were exercised; this is not a count of full differential passes.

## Completed checks

| Check | Result |
| --- | --- |
| `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | Passed; maintained three-workspace closure, repeated on final reader code |
| `npm test --workspace=@poe-code/ssconvert` | Fresh execution passed: 193 files, 4,704 tests |
| `npm run lint --workspace=@poe-code/ssconvert` | Passed: ESLint, source and test TypeScript checks |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Passed: maintained 18-workspace closure and native postbuild |
| `node --import tsx --test` with all six registered `ssconvert*.test.ts` command files | Passed on final reader code: 76 tests, zero skips/cancellations |
| Maintained terminal screenshot route | Captured and visually inspected importer listing and SC conversion; IDs present, output `7,9`, exit 0 |
| Native CSV/status/diagnostic comparisons | Eight assessed cases matched; CSV equality does not certify metadata equality |

The eight cases cover Applix arrays, rows/names, styles/shared/renamed sheets, view, encoded strings and valid basic input, Oleo supplied cache, and SC formula import. Separate native XML observations cover dimensions, formats, names, row/column metrics, alignment/protection and selected metadata. Earlier malformed Applix fixture attempts were failures and are not counted as passes.

Two attempts did not qualify as gates: root `npm test -- --workspace=@poe-code/ssconvert --no-cache` rejected its unsupported workspace selector; `SAFE_BASH_TEST_RG='ssconvert-text.test.ts' npm test --workspace=@poe-platform/safe-bash` launched the whole Safe Bash suite because that variable is not a test-file selector. That run was interrupted, had an unrelated csvformat stress failure, and is not a passing full gate. The explicit six-file command suite above subsequently passed. No full repository or packed-consumer gate is claimed.

## Remaining mismatches and unmeasured cases

Oleo's native GLib warning wrapper includes process identity and wall-clock timestamp; the product preserves the measured static `Invalid expression` message and A1 location but does not reproduce the dynamic wrapper. Other parser-specific diagnostics are unmeasured.

Coverage does not establish universal syntax or diagnostic parity. Unmeasured cases include Applix quoted-cache overwrite with multibyte decoded text, the full malformed header/record/quoting matrix (including ignored malformed Num ExtLinks records), C integer overflow, floating-point overflow/underflow and rounding boundaries, every expression construct across all three providers, expression-only repeated Oleo records, rename collisions, asynchronous mid-import cancellation, and alternative locale/dependency/font profiles. Unsupported or unmeasured cases are not passes. The frozen Sans 10 metrics apply only to the captured reference profile.

Released quirks deliberately retained include Applix's ASCII quoted-cache first-byte overwrite and descriptor protection caching, Oleo supplied expression caches remaining clean until recalculation, and SC successful-import warning suppression. These observations do not authorize native execution or host-shell fallbacks.

No commits, pushes, publication or README edits were made for this task. Unrelated work was preserved. Owned temporary logs, screenshots and captures were purged after extracting this evidence; inherited oracle/source directories were retained.
