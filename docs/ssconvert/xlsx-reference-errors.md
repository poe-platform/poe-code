# XLSX reference errors and LibreOffice 26.8

Issue #4053 is a LibreOffice OOXML formula-parser regression. ssconvert must continue writing the standard `#REF!` error literal and its `t="e"` / `#REF!` cached result. Changing it into another error, a string, or a synthetic formula would change workbook semantics.

## Independent reproduction

A workbook authored directly as a five-part ZIP, without ssconvert, defined names, styles, or iteration settings, reproduces the problem. The parts are `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, and `xl/worksheets/sheet1.xml`. Its cells contain ordinary `<f>` elements and error caches. Both native releases recalculated the same input with fresh user profiles:

| Input formula | LibreOffice 26.8.0.3 formula / cache | LibreOffice 24.2.7.2 formula / cache |
| --- | --- | --- |
| `#REF!` | `#ref!` / `#NAME?` | `#REF!` / `#REF!` |
| `SUM(#REF!)` | `SUM(#ref!)` / `#NAME?` | `SUM(#REF!)` / `#REF!` |
| `1/0` | `1/0` / `#DIV/0!` | `1/0` / `#DIV/0!` |
| `#DIV/0!`, `#VALUE!`, `#N/A`, `#NUM!`, `#NAME?`, `#NULL!` | Correct error and formula retained | Correct error and formula retained |
| `ISERROR(#REF!)` | `ISERROR(#ref!)` / true | Original formula / true |
| `IFERROR(#REF!,42)` | `IFERROR(#ref!,42)` / 42 | Original formula / 42 |

The last two controls show why catching an error alone cannot establish its identity. The SDK regressions also check `ERROR.TYPE(#REF!) = 4` and `ERROR.TYPE(#NAME?) = 5`.

The compiled public SDK recalculated this independently authored workbook and exported both `Gnumeric_Excel:xlsx` and `Gnumeric_Excel:xlsx2`. Independent ZIP/XML inspection found `#REF!` and `SUM(#REF!)` with `#REF!` caches in both outputs. Native readback of both profiles reproduces the same release-specific difference above. This is not a defect specific to a legacy input format, the writer's metadata, or stale caches.

## Exact source cause

The failing native release reports revision `bce0998afefdbc355585ca324285661a2170ba77`. All links below pin that revision.

1. [formula/inc/core_resource.hrc](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/formula/inc/core_resource.hrc#L951) registers `#REF!` as `ocErrRef` in `RID_STRLIST_FUNCTION_NAMES_ENGLISH_OOXML`. [Line 970](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/formula/inc/core_resource.hrc#L970) also registers the same spelling as `ocStop`.
2. [include/formula/opcode.hxx](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/include/formula/opcode.hxx#L34) assigns `ocStop = 2` and `ocErrRef = 44`.
3. [FormulaCompiler.cxx:183](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/formula/source/core/api/FormulaCompiler.cxx#L183) builds resource maps in ascending opcode order. Consequently the stop spelling is inserted first. [Line 758](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/formula/source/core/api/FormulaCompiler.cxx#L758) uses `maHashMap.emplace`, so the subsequent reference-error insertion does not replace it.
4. [GetErrorConstant](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/formula/source/core/api/FormulaCompiler.cxx#L1400) recognizes `ocErrRef`, but not `ocStop`. The token therefore misses reference-error recognition. [compiler.cxx:4979](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/sc/source/core/tool/compiler.cxx#L4979) lowercases unknown tokens and creates `ocBad`; the interpreter reports `#NAME?`.
5. The writer still [explicitly emits plain `#REF!` for deleted OOXML references](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/sc/source/core/tool/compiler.cxx#L1583). The producer behavior agrees with ssconvert. The passing 24.2.7.2 resource table has the reference-error entry and no competing `#REF!` stop entry.

A direct native UNO probe, bypassing XLSX import, confirms the collision:

| Native operation in 26.8.0.3 | Result |
| --- | --- |
| `FormulaOpCodeMapper.getMappings` for `#REF!`, English or ODFF | opcode 44 (`ocErrRef`) |
| Same lookup with OOXML language | opcode 2 (`ocStop`) |
| `FormulaParser` with English compilation and OOO or XL_A1 convention | opcode 44 |
| Same parser with XL_OOX convention | opcode 14 (`ocBad`), string `#ref!` |
| XL_OOX parser with a rebuilt map from available OOXML mappings, including error constants | opcode 44 |

The rebuilt map probe is a diagnostic control, not an ssconvert workaround. It proves that repairing the consumer's symbol map restores error recognition without changing the formula.

## Verification and scope

`xlsx-independent.test.ts` exercises SDK recalculation from an independently authored in-memory ZIP with deliberately wrong `#NAME?` caches. For both XLSX profiles it independently parses output XML to verify formulas, cell types, and fresh values for all standard errors and the identity controls above, then checks reimported reference-error caches.

The native Linux 26.8.0.3 archive had SHA-256 `d0a6031a3837e48f9854e6d2da6489b9fadbd814afa4741fa32a197741663a22`, matching the official download metadata. The control was LibreOffice 24.2.7.2 `420(Build:2)`. Native conversion and direct parser probes ran in a dedicated Linux container because the installed macOS application stalled before startup.

The maintained ssconvert workspace build closure, lint/type checks, and test route passed (489 files / 26,200 tests, plus seven HarfBuzz verifier tests).

This resolves the cause investigation in #4053 and protects ssconvert's correct semantics. It does not claim that LibreOffice 26.8 can correctly read these errors, or that unrelated Lotus interoperability work is complete. The consumer resource table needs an upstream correction; no ssconvert formula rewrite is appropriate.
