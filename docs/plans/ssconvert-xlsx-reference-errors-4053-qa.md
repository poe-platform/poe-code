# Issue 4053: XLSX reference-error investigation QA

## Objective

Determine why Calc changes standard `#REF!` formulas into `#NAME?`, using an independently authored workbook and exact source inspection. Preserve ssconvert's correct error semantics. Record the result in [the investigation](../ssconvert/xlsx-reference-errors.md).

## Agent-executed checks

1. Author a five-part XLSX ZIP directly, without using ssconvert. Include bare `#REF!`, `SUM(#REF!)`, `1/0`, all other standard error literals, `ISERROR(#REF!)`, and `IFERROR(#REF!,42)`. Exclude defined names and iteration settings.
2. Recalculate it in LibreOffice 26.8.0.3 revision `bce0998afefdbc355585ca324285661a2170ba77`, with a fresh user profile. Inspect worksheet formulas, cell types, and caches directly from the ZIP using an independent XML parser. Verify that only reference-error literals become unknown names; catching an error does not prove its identity.
3. Repeat the same workbook in LibreOffice 24.2.7.2. Verify that both reference-error formulas and caches remain `#REF!`, and that the other controls remain correct.
4. Recalculate the independent workbook through the compiled public SDK and export both `Gnumeric_Excel:xlsx` and `Gnumeric_Excel:xlsx2`. Inspect the package XML independently before passing both outputs to the two native releases. Verify the same consumer-specific difference.
5. Inspect the exact revision's OOXML resource table, opcode values, map construction order, hash insertion behavior, error recognition, and unknown-token handling. Establish the collision between `ocStop` and `ocErrRef` for `#REF!`.
6. Probe the exact native UNO parser directly: compare English, ODFF, and OOXML symbol lookups; compare OOO, XL_A1, and XL_OOX reference conventions. Verify OOXML lookup returns opcode 2 and XL_OOX parsing returns opcode 14 / `#ref!`, while other conventions return opcode 44.
7. Rebuild the diagnostic parser's map from all available OOXML mappings, including error constants. Verify unchanged `#REF!` now parses as opcode 44. Do not rewrite ssconvert formulas as a workaround.
8. Run the in-memory SDK regressions for both export profiles, including `ERROR.TYPE(#REF!) = 4` and `ERROR.TYPE(#NAME?) = 5`, with intentionally wrong input caches. Independently inspect fresh output XML and verify reimported reference-error caches.
9. Run the maintained ssconvert workspace build closure, lint/types, and tests. Verify the final diff and deliver the regression protection and diagnosis to remote main before closing #4053.

## Results

Steps 1–8 passed. The consumer failure in step 2 is the expected reproduced defect, not a passing interoperability assertion. Both native versions and compiled SDK profiles were exercised in a dedicated Linux container. The rebuilt native map restored opcode 44 without changing the formula. Package build closure and lint/types passed. The maintained `npm test --workspace=safe-bash-command-ssconvert` route passed all 489 test files / 26,200 tests and all seven HarfBuzz verification tests. Remote delivery is recorded with the issue closure.

Temporary fixtures, downloaded binaries, scripts, logs, and generated proof belong in `out/4053` and are removed after use. The committed investigation retains the findings, versions, source links, and reproducible method.
