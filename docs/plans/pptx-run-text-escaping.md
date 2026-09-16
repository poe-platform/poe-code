# Direct run text assignment

Own the small `mutateTextRuns` C0 validation/encoding adjustment and original
`packages/pptx/src/text-run-assignment.test.ts`. Coordinate `text-runs.ts` with
the international metadata worker; root stages the two specific fix hunks from
an independent index patch. No shared codec is justified for this run-specific
boundary: tabs and newlines remain inside one run, while frame assignment has
different paragraph and soft-break semantics.

## TDD and behavior

The initial focused run reproduced four failures: direct assignments containing
ESC, VT, LF plus VT and bell were rejected as invalid formatting. Six ordinary,
Unicode, whitespace, empty and literal-escape cases passed after correcting the
test's use of the extraction API. Independent Saxes parsing asserts literal
persisted text; paired CLI/SDK outputs must have identical bytes. Inputs and
outputs use `memfs` only.

Allow XML-forbidden C0 controls only for the text value and serialize them as
uppercase `_xHHHH_` strings. Keep TAB/LF/CR, literal `_xHHHH_` spellings, Unicode
combining sequences and supplementary characters unchanged. Do not decode
caller text. Continue rejecting lone surrogates and invalid XML scalar values
before package admission. Font declarations retain their existing validation.

## Validation and QA

The first successful focused check ran the new original suite and neighboring
run SDK, command and formatting suites: four files, 111 tests passed. The final
check includes four scalar-admission regressions: four files, 115 tests passed.
`npm run lint --workspace=pptx` passed ESLint and both TypeScript configurations.
Root verified `npm test --workspace=pptx`: 72 files and 1,892 tests passed.
The actual Shell run-help and invalid-attribute screenshot at
`/tmp/pptx-international-help.png` was complete and readable (exit 0 and 2).
No application rendering, font installation, downloads, push or release is part
of this fix.

The exact source-case mapping remains research-only in
`docs/pptx/international-fields-case-map.json`. Live `_Run` and `_Paragraph`
owner models remain explicitly outside this bounded operation fix.
