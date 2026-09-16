# Public values integration evidence

This receipt is bounded; it does not certify the whole presentation object graph.
The pinned inventory remains authoritative for outstanding public members.

`Font.language_id` now reads/writes numeric `MSO_LANGUAGE_ID` values through the
existing live Font binding and run-properties merge. Missing XML language reads
`NONE` (0); assignment of null or NONE removes the override. Unknown XML language
values fail on enum access without changing imported content. Invalid inputs fail
before mutation. Run invalidation also invalidates its font's language access.

The original `font-language-model.test.ts` covers read values, memfs XML roundtrip,
retained text/false formatting, removal, coercion rejection and invalidation.
All 15 cases failed before implementation and passed after. The four read cases
retain the pinned language getter variants; setter removal and replacement behavior
retain the meaning of the six pinned setter variants. No source code or binary
fixture was copied. Extra invalid/coercion/ownership cases have no upstream-test
dependency. CLI `text runs set` and SDK `mutateTextRuns` retain the existing
`language` string option; both model and operation use `runPropertiesMerge`.

J08 error categories now have OfficeError subclasses: IndexError
(`index-out-of-range`), KeyError (`missing-key`), ValueError (`invalid-value`),
PropertyAccessError (`property-unavailable`), and TypeError (`invalid-type`). Five original constructor tests
failed before implementation and passed after. Their stable phases preserve the
existing command envelope classification without a second CLI error mapper.

Related receipts: [collections](public-collections-evidence.md),
[helpers](public-helpers-evidence.md), [enums](public-enums-evidence.md).

## Final verification

The maintained pptx workspace suite passed 5,903 tests in 201 files. Workspace
lint and both TypeScript checks passed. The selected workspace build closure
passed, followed by direct built-export and live-language checks. The first
built-language probe used a 20-node budget and correctly failed the structured
merge limit; it passed with the same 100-node budget as the original unit case.
No CLI grammar or visual layout changed, so no screenshot was required.
