# Chart editing implementation and QA

Scope: implement the contract's bar, column, line, pie and scatter operations in
`packages/pptx`; adapters remain in `packages/safe-bash/src/commands/pptx` and root
only wires exports. Work on main; preserve other work; commit owned files only
after maintained checks. No push, release, whole pipeline or README edits.

## Ownership

- Integrating owner: package wiring, independent review, maintained checks,
  disposable QA, local atomic commits and completion receipt.
- Domain delegate: original failing tests followed by chart XML/data/workbook
  implementation in owned package files.
- CLI delegate: command admission, shared schemas, SDK dispatch and memfs adapter
  acceptance tests in owned command files.
- Accounting delegate: this plan and new chart-editing research/API/case/usage
  receipts. No product changes and no commit from this delegate.

## Contract and test procedure

1. Read root/scoped instructions, `docs/specs/pptx.md` section 6.6 and Appendices
   A–C, plus shared Office SDK/CLI contracts. Keep the 19 requested-family enum
   variants separate from the full 29-symbol proposed creation contract.
2. Reproduce absent creation/edit behavior with fast original in-memory tests.
   Expected XML is authored independently of serializer output. Assert direction,
   grouping, series indexes/order, categories, missing values, paired scatter
   coordinates, axis cross-references, styles, titles/legend and deterministic IDs.
3. Assert malformed length/type/number/category/series input fails before mutation;
   reject unsafe or unsupported workbook ownership rather than updating caches
   alone. Tests must not use downloads, host files or native processes.
4. Verify SDK and plural `charts` commands share domain behavior, selectors,
   publication, JSON envelope, exit statuses, schema and capabilities. Mutation
   options require explicit output or in-place authority.
5. Retain every relevant source parameter variant and expanded BDD case in the
   research map. Link precise original assertions; unsupported model behavior,
   hierarchical data, variants or advanced styling remain visible obligations.
   Retain inherited/underscored public members, enums, protocols and untested APIs.
6. Run maintained package lint/unit and selected workspace build closure plus
   the maintained adapter integration routes appropriate to the actual edits.
   Record exact results after execution; do not infer passes from case counts.
7. Capture and inspect changed human CLI output using the repository screenshot
   route. No screenshot unit tests. Record any output correction and original
   regression, then rerun only affected maintained checks.

## Disposable corpus QA

Use only manifest-listed inputs after verifying SHA-256, with explicit larger
trusted QA ceilings if needed. The chart-bearing fixture is
`.cache/pptx-corpus/data-visualization-course.pptx` with SHA-256
`ce874bc9782258175b84f5e438123552b78c993e0add9015f35d8ca2dd5c45d2`.
Its acquisition census includes style-related chart XML parts; that count is not
the number of chart objects. The previous read-only inspection receipt counted
eight chart objects, seven classic and one modern.

Use a disposable copy and compare SDK/CLI chart records. For a supported chart,
apply a bounded metadata change and independently inspect affected XML; verify
unaffected themes, chart relationships, embedded workbooks and opaque structures
retain bytes. For an unsupported/complex workbook, verify data replacement fails
without publication. Create an original supported chart in a disposable deck,
inspect package relationships and synchronized workbook/cache values, then reopen
through both surfaces. Independent rendering may be used only for QA; it cannot
be a product dependency or establish semantic equivalence by itself.

Reduce a meaningful finding to small original in-memory XML/data before fixing
it. Do not stage binaries, copied snippets or renderer outputs. Retain concise
receipts; delete only explicitly owned disposable outputs when the campaign ends.

## Provenance boundary

Consult `docs/pptx/upstream-test-audit.md`, `upstream-test-inventory.json`,
`upstream-api-audit.md`, `upstream-api-inventory.json` and existing chart-inventory
maps. Pinned reference source is at `/tmp/pptx-upstream-review`, commit
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be`. Its identities and source snippets
remain research-only. Existing standalone MIT notices remain applicable to
inherited provenance. Use original test data/assets and neutral product naming.

## Execution receipt

Completed domain creation/editing, simple embedded worksheet synchronization,
CLI/schema/capability wiring and original independent XML assertions for the 19
selected variants. Separate workers owned domain, adapter and research files;
the integrating owner implemented the workbook codec and preservation regressions.
Existing image-replacement work remains outside this change and is preserved.

TDD exposed invalid formula acceptance, shadowed style mutation, missing series
count support, loss of markers/smoothing on new series, date axis/epoch metadata,
nonconventional unrelated workbook tables, stdin in-place admission and schema
length representation. Tests preceded their respective corrections; an early
legend-preservation review was backed by concrete code inspection and then an
original regression. A fixture ZIP-version mismatch was corrected in the test
using the maintained writer, not treated as a product defect.

Maintained package tests (3,416 tests / 123 files), package lint/typechecks,
selected workspace build, six chart adapter tests and the exact integration
registration check passed. Manifest-authenticated SDK/CLI corpus QA preserved
214 and 35 unrelated parts respectively; independent ZIP/XML assertions verified
scatter caches and cells. Screenshots of help and inventory were inspected;
misleading mutation help is corrected under a separate focused regression.
See `docs/pptx/chart-editing-evidence.md` for exact receipts and limitations.
No whole pipeline, README edits, push or release is authorized or performed.

Final help-only verification passed all 17 chart command tests, maintained package
lint and selected workspace build. Recaptured help and inventory screenshots were
visually inspected. Delivery is one atomic chart-editing improvement; stage only
the named chart domain/codec/tests/research files and selective chart hunks in
shared wiring files, excluding existing image work. Report the resulting local
commit separately from any remote delivery (none requested).
