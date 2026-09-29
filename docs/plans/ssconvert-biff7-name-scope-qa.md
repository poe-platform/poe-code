# BIFF7 local-name scope qualification (issue 4075)

Keep temporary workbooks, command captures and native application copies in `out`
and remove them after qualification. Execute these steps as an agent; this is a
manual interoperability plan, not a test script.

1. Inspect Gnumeric `plugins/excel/ms-excel-write.c`, `excel_write_NAME`, and
   `ms-excel-read.c`, `excel_read_NAME`. Gnumeric writes both NAME offsets 6 and 8
   as one-based fields, but its BIFF7 reader resolves offset 6 through EXTERNSHEET.
   Confirm that old exports with only offset 6 populated still resolve by that
   table, including a reordered table.
2. Inspect Calc `sc/source/filter/excel/xiname.cxx`, `XclImpName`: offset 8 gates
   locality; BIFF5/7 offset 6 is used directly as the zero-based Calc sheet index.
   This differs from Gnumeric's legacy interpretation. Do not infer native
   compatibility from matching one-based fields or from our own roundtrip.
   The export targets Calc's actual behavior: zero-based offset 6 and one-based
   offset 8 for local names. Import uses populated offset 8 for worksheet identity,
   with the old EXTERNSHEET interpretation as fallback when offset 8 is absent.
   Gnumeric's offset-6-only BIFF7 reader is not a native qualification target for
   this encoding; do not claim that it preserves this export's scope.
3. Run every `biff*.test.ts` in the ssconvert codec directory. Require independent
   byte vectors for first/last/global scope, reordered legacy links, old missing
   scope markers, direct indexed qualified names, and invalid worksheet scope.
   Check BIFF7, BIFF8 and both streams of dual-format exports.
4. Create two worksheets named First and Last. Define Rate globally as 11,
   locally on First as 22, and locally on Last as 33. Add ArrayName globally as
   `{1,2;3,4}`, on First as `{2,3;4,5}`, and on Last as `{5,6;7,8}`; define
   AliasArray on each worksheet as its local ArrayName.
5. On First, evaluate Rate, Last!Rate, []Rate, SUM(AliasArray),
   SUM(Last!AliasArray), and SUM([]ArrayName). Export BIFF7 and BIFF8. Open each
   in native Calc and save as XLSX. Inspect workbook.xml independently: global
   names must have no localSheetId, First names must have 0, and Last names 1.
   Require six recalculated values: 22, 33, 11, 14, 26, 10. In particular, a
   populated marker with a one-based offset 6 must fail qualification because
   Calc moves or discards local names; legacy NameX must fail if it yields #NAME?.
6. Run ESLint on edited codecs and tests, and the package source and test
   TypeScript checks. Rebase onto latest remote main, repeat affected checks if
   overlapping code changes, commit explicit paths, push HEAD to main, verify
   the commit is on remote main, then close issue 4075.

## Qualification receipt

On 2026-09-28 the independent native Calc 26.8.0.3
(`bce0998afefdbc355585ca324285661a2170ba77`) XLSX inspection retained global, First,
and Last Rate and ArrayName definitions plus both local AliasArray definitions.
BIFF7 and BIFF8 both recalculated all six cells to 22, 33, 11, 14, 26, 10.
The intermediate matching-one-based-field export moved First's Rate to Last and
lost Last's Rate; the corrected scope fields retained both, and direct indexed
internal name references removed the cross-sheet #NAME? failure.
