# Legacy text independent reader review

Scope: independent stress and validated repairs to SC, GNU Oleo and Applix readers, with root retaining shared parsing, export metadata, integration and Git ownership. No commits, pushes, publication or README edits were performed by this reviewer.

## Reference and procedure

Use the authenticated Gnumeric 1.12.61 archive extracted under `out/ssconvert-lifecycle/gnumeric-1.12.61`; archive SHA-256 is `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Inspect `plugins/sc/sc.c`, `plugins/oleo/oleo.c` and `src/number-match.c` against the current TypeScript reader before proposing repairs. The durable [reference profile](../ssconvert/legacy-text-reference-profile.json), [native evidence](../ssconvert/legacy-text-native-evidence.json) and [verification record](../ssconvert/legacy-text-verification.md) replace temporary root captures.

For native QA, use the separate `ssconvert-statistics-qa` Docker container, explicitly selecting `Gnumeric_sc:sc` or `Gnumeric_oleo:oleo`; select CSV or native Gnumeric XML output. Use the captured prefix library/schema/data paths and `GSETTINGS_BACKEND=memory`, `LC_ALL=C`, `LANG=C`, `TZ=UTC`. Place original fixtures and generated output only under `out/ssconvert-legacy-independent`. Capture exact status/stdout/stderr; inspect XML cell value types, expressions, styles and dimensions instead of treating successful conversion as parity. Native code is never called from unit tests or product readers.

Run the independent in-memory fixture tests through the actual SDK engine and command engine. The one namespace-effect test uses memfs and verifies untouched input/sentinel files and absence of output after failure. Unit tests use injected byte sources/sinks, no native processes, disk writes or LLMs.

## Verified review outcomes

- 28 independent unit cases passed with `npx vitest run packages/ssconvert/src/codecs/legacy-text-independent.test.ts` on September 20, 2026. This is focused coverage, not a repository-wide gate.
- Twenty-three original native import fixtures were exercised. Only the comparisons described below were assessed; this count is not twenty-three full differential passes.
- Oleo coordinate-only/ignored-field records retain an existing value. The previous implementation replaced it with blank; a regression failed before repair, and native CSV produced `7`.
- Supplied Oleo expression caches remain valid until explicitly recalculated. A regression failed with `7,9` where native produced `7,99`; explicit recalculation still produces `7,9`.
- Oleo simple values preserve date/percentage/currency/apostrophe/empty text as strings. Native XML confirmed all five types, plus hexadecimal text and numeric subnormal decimal. The prior date/text-entry inference produced unwanted numbers/formats and removed apostrophes; the regression failed before repair.
- Oleo invalid-expression diagnostics now identify `Sheet1!B3` instead of numeric `2,3`, and map the shared parser's generic `Invalid formula` to measured native `Invalid expression`; both diagnostic regressions failed before repair.
- Oleo format coordinate scanning accepts native leading whitespace; format precision requires an initial digit. Native `Fr 2c 3FF+2` produced a value at row 1, column 2 with format `0`; the previous implementation lost the cell. Supported alignment now has Gnumeric style metadata for writers.
- SC numeric format scanning follows adjacent native `%i` conversions, including octal/hexadecimal boundaries and rejection of a malformed numeric field before a required conversion. Regressions failed before repair. Native XML confirmed `format A 08 2 0` maps to `##0.00000000E+00`, and `format B 0x10 01 0` maps to `#.0`.
- Native successful SC imports suppress accumulated warnings. Unknown `exec`/`system`, invalid expressions and ignored format definitions produced exit 0 with empty stdout/stderr; these directives remain workbook data. Fatal coordinate errors expose accumulated warnings in order and exit 1. A memfs command regression reproduced and repaired an extra final newline and verifies exact native diagnostic bytes with no output publication.
- SC precision `-1` behaves as native missing precision. The regression failed before repair; a native fatal import confirmed the precision warning precedes the coordinate warning.
- SC column formats affect `format=preserve` output. Native `1.50,text` matched repaired output where the prior implementation emitted `1.5,text`. Existing cells receive effective column styles, with Gnumeric style nodes; whole-column style regions, hard widths and cursor selections are retained for export.
- SC format widths use the frozen native Sans 10 metrics: eight-pixel average digit width and 18 pixels per 12.75-point default row. Native widths 1, 2, 10, 16 and 20 yielded XML points `8.5`, `14.17`, `59.5`, `93.5` and `116.2` (native writer rounding), replacing the previous approximation. Only this captured font profile is measured.
- SC width-only wide columns grow the sheet; zero-width out-of-bounds style records do not. Native `format ZZ 10 2 0` grows to 1024 columns, while `format ZZ 0 2 0` retains 256. Both prior product cases failed workbook validation before the fixes.
- SC reference names, zero-based coordinates, dimension growth and native lowercase `power` serialization are covered. Native named-target lookup was measured as case-sensitive, so no speculative case-folding repair was applied.
- Already-cancelled imports are covered for all three providers; precision expansion is bounded before allocation.
- Applix missing `Open Cell` produces the native `Invalid sheet name.` import failure; empty `Open Cell` tokens are rejected. Focus parsing now follows cells, matching native sheet creation/order timing.
- Applix quoted expression cache values retain the released `applix_parse_value` first-destination-byte overwrite behavior. The measured ASCII escaped cache `a\"b` becomes native `b\"b`, replacing the prior conventional unescape result. No native pointer operations are executed by the product.
- Applix colormap records require their native terminal space. Native no-terminal-space input fails with `invalid colormap`; the same record with terminal space succeeds. Descriptor style caching preserves the first protection flags even when later records use different `P`/`I` prefixes. Both regressions failed before repair.

## Remaining limits and mismatches

Native Oleo GLib warnings contain dynamic process identity and wall-clock timestamp; the product diagnostic does not reproduce that wrapper. Exact diagnostic parity remains incomplete despite repairing the measured static warning message and location. Other parser-specific warning strings remain unmeasured.

This independent cohort does not certify all Applix records, all formula constructs, every malformed quoting case, integer overflow behavior in C conversion routines, every floating-point rounding/underflow boundary, expression-only repeated Oleo records, all locale/dependency/font profiles or asynchronous cancellation mid-import. Applix quoted caches containing decoded multibyte characters may differ because the native overwrite operates on UTF-8 bytes; only the ASCII case above is verified. These remain unmeasured rather than passes. Root owns integration checks and the final maintained uncached build/test/lint evidence. Preserve temporary capture evidence until root extracts its final findings; purge temporary artifacts after use.
