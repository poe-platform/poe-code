# Independent legacy binary reader stress QA

This procedure and record cover all four legacy binary readers. A different agent from their implementer inspected the pinned Gnumeric 1.12.61 source under `out/ssconvert-lifecycle/gnumeric-1.12.61/plugins` and authored original small byte fixtures. Psion tests use the root-authored in-memory fixture helper and the JavaScript codec qualified against Psiconv 0.9.9 primary source. No unit case writes files, spawns native tools, or accesses host capabilities.

## Procedure

1. Read `qpro-read.c` record dispatch, formula decoding, string conversion, warnings and style handling, and `pln.c` record/cell/formula/style decoding.
2. Run `npx vitest run packages/ssconvert/src/codecs/qpro-pln-stress.test.ts --no-cache` before fixes. Preserve concrete failing assertions before changing production code.
3. Fix only confirmed defects in the assigned readers, then rerun that suite uncached.
4. Run `npx eslint packages/ssconvert/src/codecs/qpro.ts packages/ssconvert/src/codecs/pln.ts packages/ssconvert/src/codecs/qpro-pln-stress.test.ts`.
5. Run the existing `legacy-binary.test.ts` suite alongside the stress suite; report integration failures to the root owner rather than modifying other readers or provider exports.
6. Root separately runs maintained package/workspace build, lint and test routes and native differential QA. These focused commands are supplemental checks, not substitutes for those routes.

## Verified cases and repairs

Eight independent stress cases pass after two red-before-green repairs:

- PlanPerfect previously returned one sheet when the sheet budget was zero. It now admits the sheet before construction and throws a resource-limit error.
- Quattro previously processed a three-token formula with an operation budget of two. Formula token work now consumes one invocation-local cumulative budget across formulas, with admission before processing each token.
- Replacing the same Quattro cell twice uses one distinct cell slot.
- Quattro binary-operator stack underflow emits the source corruption warning and exact condition warning in order, discards that formula, and retains the following integer cell.
- Quattro diagnostic-triggered cancellation preserves the injected abort-reason identity.
- PlanPerfect format-only records retain bold style and skip their declared formula payload without misreading it as another cell.
- Both readers preserve an already-aborted signal's reason before admitting input (two cases).

The focused eslint command passed. The combined run passed these eight cases and the six existing Quattro/PlanPerfect integration cases. Three Lotus integration cases failed with an unknown importer while the root owner was still implementing provider registration; those are reported failures, not excluded passes or a full-suite success.

## Remaining measurements and potential mismatches

The initial source review flagged Quattro `Get Attr %u\n` output. Further inspection confirms it is inside `#if 0`; it is not compiled and is not a runtime mismatch. This correction preserves the audit trail without claiming unsupported evidence.

The Quattro/PlanPerfect sample does not cover every opcode, record, container variant, malformed length, cache-string pairing, text encoding, date behavior or style output. No native differential result is claimed here. Native unavailable-plugin profiles and differential comparisons remain root-owned QA. These unmeasured cases are not passes.

## Earlier Lotus and Psion follow-up (superseded coverage snapshot)

Run `npx vitest run packages/ssconvert/src/codecs/lotus-psion-stress.test.ts packages/ssconvert/src/codecs/qpro-pln-stress.test.ts packages/ssconvert/src/codecs/legacy-binary.test.ts --no-cache` and focused eslint for `lotus.ts`, `psion.ts` and `lotus-psion-stress.test.ts`.

Nineteen Lotus/Psion stress cases pass. The first nine exposed two Lotus failures before repair: formulas did not consume the cumulative operation budget, and cancellation triggered by the final format diagnostic was ignored. Both are fixed. Additional verified cases cover SS98's source version 0x1005, explicit unknown-version rejection, Psion altered UID checksum, out-of-bounds section-table offset, signed-integer replacement within one cell slot, both readers' pre-aborted reason identity, and explicit Psion calculated-cell rejection.

Ten further cases failed before repair: source opcode `0x204` did not set the Lotus sheet name; eight representative source-supported metadata records silently disappeared; and unknown modern records emitted no warning. The reader now uses the actual sheet-name opcode, explicitly rejects unqualified sheet-pointer/layout/width, format/style/comment and RLDB records, and emits the source unknown-record warning. The source's ignored-record list remains ignored; its large-data warning is preserved. These explicit errors represent incomplete feature coverage, not native semantic parity.

After root provider registration completed, the combined uncached run passed 37 cases: 19 Lotus/Psion stress, 8 Quattro/PlanPerfect stress and 10 initial integration cases. Focused Lotus/Psion eslint passed. The earlier three Lotus registration failures were resolved by root work; their earlier failed run remains disclosed above.

Lotus metadata, styles, RLDB, LMBCS group 12, comprehensive formula and other record semantics remain unqualified. Psion formulas, calculated cells, variables, paragraph/character layouts and row/column layouts remain explicitly unqualified. Psion page-layout and status-section semantic validation is also unqualified: structural byte availability checks do not establish complete parsing or native warning parity. Full record/opcode, native diagnostics, locale and corruption parity is not established by this sample.

## Final independent follow-up

The earlier unsupported snapshots above are retained as history. Lotus selection/viewport, FORMAT repeats/DUPFMT, STYLE pools, comments and five active RLDB databases now have source-derived implementations and dedicated fixtures. LMBCS12 uses captured codepage-950 facts. Psion formula structures, variable types, paragraph/character/axis layouts and styled/styleless page TextEd now have implementations. Consult the current [coverage record](ssconvert-legacy-binary-importers-qa.md) for remaining limits.

Independent formula review fixed red-before-green Psion vararg separator/end 42/43 and rejected invented end44. Independent Lotus metadata review added nine cases. Independent Gnumeric export review added 13 cases and fixed numeric horizontal-alignment enum serialization. Independent Works review added eight cases, reproduced loss of existing font attributes under a partial style assignment, and fixed the merge; its combined focused run passed 35 tests and scoped lint.

A different agent reviewed the latest styled Psion page and structurally ignored Unicode-font repairs: ten additional page cases verify inline Unicode fonts, malformed font/color/size/bool lengths, preview pointer bounds, paragraph-count budget and mid-page cancellation. Four additional Lotus cases verify explicit unknown versions 0x1006/0x407/0xffff route to modern record dispatch while auto probes reject them, and cancellation from their warning preserves reason identity. Combined final focused run: 38/38; scoped lint passed. No further runtime defect was validated. Embedded-object tests verify the explicit unsupported failure mode only, not successful imports.

Psiconv embedded primary inventory: section IDs display 0x10000146, icon 0x1000012a, nested table 0x10000144; recursive native dispatch supports Word UID 0x1000007f, TextEd 0x10000085, Sheet 0x10000088, Sketch 0x1000007d. Native display parsing is gated by the icon pointer; nested parsing uses the whole suffix. Those four nested types now have JavaScript structural parsers; missing nested tables retain an explicit native-unsafe gap. No guessed skip or native fallback was added. Optional native Psion absence and exact diagnostic/export gaps remain explicit in root evidence.

Later independent QPro review added ten cases and fixed blank records dropping style-reset effects, unavailable source function names being invented as function calls, and value records deleting existing expressions. Source registration inventory supplies 33 unavailable names; native AVG fixture confirms unsupported-function token/stack behavior and its following corruption condition. Exact native invalid-zoom, minimum-length and short-argument comparisons accompany root's terminal-byte fixes. Final focused QPro run 38/38; scoped lint passed.

Embedded review added 13 independent cases and reproduced two failures before repair: deferred nested TextEd/Sheet bodies allowed later failures to replace the first native error. A shared generator stack now follows source depth-first order without host recursion. Cases include 1,500 levels, shared sheet/cell/operation limits, relative pointers, cancellation, root namespace preservation, valid Word styles and valid Sketch. Word helper has 22 initial cases; its excess-hotkey and mismatched-paragraph unsafe source paths remain explicitly unqualified. Sketch initial 20 plus independent review cases verify all compression families, low-byte RLE behavior, row alignment, full token consumption, wrapper pointers, cancellation and bounds. Follow-up source review repaired nonstandard offsets and standard 32-bit color. No successful native Psion import is claimed.

Final different-agent Sketch review added 20 cases and fixed a further error-ordering defect with two failing cases: malformed RLE and missing pixel bytes must fail before the unqualified greater-bit-depth branch. Final combined Sketch run 57/57, scoped lint and test typecheck passed. Covers relocated section 37, declared offsets 0/39/41, trailer bounds, row alignment at depths 0/1/7/8/9/15/16/17/23/24/25/31/32 and cancellation before the trailer. Depths above 32 are unmeasured; they are not universally native UB or universally rejected (e.g. color33 has 11-bit channels). Source nonstandard-offset diagnostic chains remain unmeasured. Existing greater-depth fixture now provides five admitted raw bytes so its unchanged unsupported assertion isolates qualification rather than an earlier corruption error.
