# Table accounting and bounded QA

Scope: implement grid dimensions, empty/text cells, row/column sizes, style references and supported direct cell formatting. The main task owns integration and commits. This accounting task owns the table case/API receipts and usage draft. No whole pipeline, push, release, README change or downloaded fixture publication is authorized.

## Research reviewed

The authoritative `docs/specs/pptx.md`, shared CLI/SDK contracts, pinned test/API audits and inventories, and `/tmp/pptx-upstream-review/tests/test_table.py`, `tests/oxml/test_table.py`, `features/tbl-*.feature` establish the behavioral obligations. `docs/pptx/tables-case-map.json` retains 171 unit identities and 41 expanded BDD identities, including exact parameter bindings and adjacent creation, classification and hyperlink-in-cell scenarios. Font-file tables and the unrelated relationship mixin are excluded by source location. Partial and deferred rows are not parity passes.

`docs/pptx/tables-api-map.json` retains table classes, underscore-prefixed returned types, inherited members, collection protocols, adjacent accessors and documented-only mistakes. Cell `row_idx` and `col_idx` are prose mistakes; use explicit traversal/report coordinates. Neutral snake_case model spelling is separate from camelCase operation fields. Do not count an operation function as a complete live model.

## Disposable corpus inspection

Read-only ZIP/XML census of already cached manifest entries found 28 tables in seven inputs. No bytes were downloaded, edited, shipped or used in unit tests. This is structural fixture selection, not product or rendered visual acceptance.

- `SEWP_Training_Slides_May 2026.pptx`, `ppt/slides/slide12.xml`: two rows, three grid columns, six physical cells, three cells with span/continuation metadata, two empty cells. This demonstrates that a span does not reduce the physical XML cell count.
- `slides-public-engagement-DEC-2021.pptx`, `ppt/slides/slide9.xml`: a 4×4 table with twelve empty cells and theme-linked colors, plus an entirely empty 1×1 table with theme formatting.
- `SEWP_CH_Training_Presentation_05_12_25.pptx`, slides 11, 21 and 30: theme-linked formatting across 2×4, 5×2 and 1×3 tables.
- `20120418_Jedlovec_SuomiNPP.pptx`, slide 4: 6×3 physical grid with four cells carrying merge metadata and seven empty cells.
- `data-visualization-course.pptx`, slide 7: 26×16 physical grid, 416 cells, 178 empty; slide 4 is an entirely empty 6×4 table.

Original small regressions must assert physical/logical distinction, empty text preservation and theme retention without copying any fixture assets or publisher wording. Parent task performs admitted product QA and records its actual outcome separately.

## Agent verification procedure

1. Run focused original table tests to establish failures before domain changes.
2. Run maintained package unit and type/build checks after implementation, with explicit SDK and command assertions.
3. Compare each source parameter to an independent expected value/XML assertion. Preserve deferred merge/split and structural algorithms as explicit gaps.
4. Check equal requests retain serialized bytes and integrity hashes, and changing one cell preserves untouched theme formatting and package parts.
5. Verify plural resource schema/capabilities, selector bases, JSON fields and common CLI statuses.
6. Inspect CLI screenshots for exposed command changes. No automated screenshot unit tests.
7. Record actual test outcomes and local commit separately; no push or release.

## Executed focused evidence

- The independent `table-behavior-cases.test.ts` suite first ran 42 cases with four failures: banding options incorrectly read/wrote `horzBand`/`vertBand` XML attributes instead of schema `bandRow`/`bandCol`. The domain owner fixed the mapping after receiving this concrete reproduction.
- Expanded original tests then passed: 54/54, 27 ms test execution, 260 ms total focused Vitest invocation. Focused ESLint passed for the owned test file.
- The receipt records 212 cases: 30 fully covered observable cases, 63 partial semantic cases, 44 deferred structural cases and 75 remaining original-test obligations. No claim that all public model APIs or every historical source case passes.
- The API receipt contains 80 inventory records, including exact proposed TypeScript signatures, argument defaults, return types, errors and effects from the reconciled register. Direct command support does not erase remaining model obligations.
- Equal setter requests intentionally preserve lexical bytes instead of gratuitously creating empty properties or canonicalizing existing boolean tokens. This differs from some low-level source XML expectations and is explicitly partial rather than silently counted as identical parity.

## Model reconciliation follow-up

The final focused suite contains 94 original tests, all passing (95 ms test time; 461 ms focused invocation). The earlier 54-test checkpoint is superseded. Additional exact source dimensions `10pt` and `12pt` first exposed two failures: unsupported stored universal measures and NaN propagation into frame extents. The domain owner fixed parsing after reproduction; both tests now pass.

Added model cases cover all direct margin values/defaults, four invalid margin types, absent/42 EMU left-margin removal, all anchor getters/setters plus expanded BDD transitions, zero-dimension admission, 1/2/3-element collections and bounds, all six table style switches, 1.5-inch width, exact 111+222 and 100+200 extent sums, Unicode/empty cell text and physical cell role inspection. Collection tests exercise live model behavior instead of mock constructor calls.

Final 212-row ledger: 125 original observable cases covered; 14 partial cases (12 intentional boolean lexical no-op differences and two original-constructor/XML-default differences); eight explicit admission/language mappings for zero-sized raw XML proxies; 45 deferred structural merge/range/placeholder cases; 20 distinct wider model obligations. There are no undifferentiated awaiting-test records.

The wider model obligations are shape/graphic-frame classification and insertion APIs, group-owned insertion, owned-node equality, the returned FillFormat object graph, and text-run hyperlink workflow. Direct table fill/border operations do not falsely claim a complete FillFormat model. A documented inherited part view and constructor contracts also remain explicit in the separate API receipt. Null fill/border color intentionally writes noFill; only nullable margins/anchor restore inheritance/defaults.
