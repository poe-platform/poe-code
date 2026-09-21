# Independent ODS/SXC importer stress procedure and results

Scope: independent second-agent review of the new `Gnumeric_OpenCalc:openoffice` reader, including repairs to `packages/ssconvert/src/codecs/odf.ts`. Root retains integration, exports, Git and delivery ownership. This is a scoped review, not a full compatibility certificate.

## Procedure

1. Read root and `packages/safe-bash/AGENTS.md` and inspect reader/schema and workbook contracts.
2. Inspect authenticated Gnumeric 1.12.61 `plugins/openoffice/openoffice-read.c` in `out/ods-sxc-read/gnumeric-1.12.61`. Keep native code outside product code and unit discovery.
3. Construct original small ZIP/XML fixtures entirely in memory, with no native utilities, LLMs or disk writes. Any later filesystem unit workflow must use memfs.
4. Reproduce proposed repairs with failing tests before editing product code. Inspect repeat and matrix handlers to distinguish intended Gnumeric behavior from suspected defects.
5. Rerun the independent stress file and existing reader tests after repairs. Root runs maintained uncached workspace build/test/lint and cross-workspace integration checks.
6. When a captured Gnumeric 1.12.61 oracle is available, compare actual import/export status, stderr bytes, ordering, and workbook namespace effects. Record exact dependency/plugin/locale profile and source identity; do not treat source inspection as native differential execution.

## Verified results

`npx vitest run packages/ssconvert/src/codecs/odf-stress.test.ts packages/ssconvert/src/codecs/odf.test.ts packages/ssconvert/src/codecs/odf-metadata.test.ts` passed 24 cases: 15 independent stress cases, seven original reader cases and two metadata-helper cases. The first run reproduced three failures (invalid styles root, matrix interiors, queued cancellation). Three later added repair cases reproduced failures for name base-sheet identity, unparsed formula retention and missing matrix-axis warning. Each repair was then verified green. Metadata integration reproduced two additional failing cases before connecting the helper. Subsequent helper stress reproduced and repaired border inheritance/clearing and quoted database-range sheet names. `npx tsc --noEmit -p packages/ssconvert/tsconfig.test.json` passed after the helper landed.

The independent fixtures verify:

- Invalid `styles.xml` roots fail rather than silently becoming empty style sets.
- Array interior values retain their group identity and cache; implicit blank interiors are represented.
- Timer-driven cancellation during an 8000-column materialization rejects with the original abort reason. Axis and array expansion also yield cooperatively every 1024 entries.
- Materialized-cell limits aggregate across sheets; a million-row empty repeat stays sparse.
- Workbook named-expression base references retain their declared sheet and coordinates through the shared formula parser.
- Unparsed formula source, coordinates and repeat extent remain in retained source records, while valid caches survive.
- Missing matrix axes emit the source-backed warning and default to one.
- Importing a cached external reference never calls the injected external-reference capability.
- Value-attribute order determines the first valid typed value; foreign-namespace value attributes do not override it.
- An uncached formula is dirty and receives no invented cached result.
- Named style inheritance maps to the shared exportable Gnumeric style representation. Overriding one border side preserves the other inherited sides; a `none` border clears its own inherited side.
- Reader integration retains exportable annotation objects, passive hyperlink style regions and basic database-filter records. Quoted sheet names containing dots are parsed using the shared formula grammar rather than split at the first dot.
- A final independent regression reproduced missing annotation inline spans and significant spaces/tabs/line breaks, then verified the repair preserves their order and paragraph boundaries. Annotation space expansion charges the shared work budget before allocation.
- Hyperlink classes and current-workbook targets now follow `oo_cell_content_link`: case-sensitive `http`, `mail`, and `file` prefixes select their respective types; other targets select current-workbook links, remove an initial `#`, and change the first dot to `!`. This source-backed regression was red before repair. URI classification never fetches a target.

The final scoped rerun passed 20 cases: 18 independent stress cases and two helper cases. Root owns the latest reader changes and final maintained gates. Native oracle construction subsequently succeeded under root ownership; this independent reviewer did not execute it, so native differential results must come from root's separate evidence.

After root's fresh native-reader changes, another independent reader stress run passed 26 cases in `odf-stress.test.ts`. Added verified cases cover cyclic embedded-object deduplication; relative object-image resolution; binary NUL-byte preservation as hex; aggregate retained-image text budgets; aggregate embedded XML node budgets; pending embedded-resource cancellation with original abort reason; passive external/missing relationships and package escape rejection; cached formulas remaining dirty; and exact doubled unknown-element diagnostic sequence. These are unit controls, not native drawing/export equivalence.

That review also reproduced one additional resource-accounting failure before repair: `number:scientific-number` expanded 20000 exponent placeholder digits despite a 10000 shared work budget. The implementation now charges the exponent expansion before allocating it, and the regression passes.

Source audit confirms `oo_cell_end` copies values into repeated cells without copying formulas. The original repeat test matches that handler and was preserved.

## Remaining unsupported or unmeasured cases

No native differential execution was available to this reviewer. Byte-for-byte status/diagnostic/ordering parity across the full released dependency/plugin/locale profile remains unmeasured; passing unit cases do not close that gap.

The following are outside the independent verified cohort and must not be counted as passes: malformed named-expression base warning parity; legacy date/time automatic default formats; C scanner permissiveness for malformed numeric/date/duration attributes; zero-repeat behavior; style default precedence when a repeated cell crosses columns with different defaults; overlapping matrix ranges and overrides; external reference cache recalculation under explicit host capabilities; manifests with unusual valid ZIP names or encrypted subparts; complete conditional-format/validation translation; full nested chart rendering/export and image-format decoding/export; relationship fragments/query components and percent-encoded absolute URI normalization; database filter execution and OR/grouped conditions; and print pagination/round-trip output. Annotation rich-text font export and uncommon inline extensions are not independently verified. Full metadata export and native print-layout equivalence remain unmeasured. Long binary-to-hex loops are budgeted but do not themselves yield to timer-driven cancellation; tests verify pending decode/XML/resource cancellation, not arbitrary preemption of synchronous hex serialization.

Invalid styles-root rejection and retained unparsed-formula records are deliberate product validation/preservation behaviors checked here; they have not been compared with native error recovery behavior. Matrix warning text is source-backed, but locale-rendered warning bytes are not independently measured.
