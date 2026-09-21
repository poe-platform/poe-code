# Independent Gnumeric follow-up stress procedure

Run original in-memory unit fixtures from `packages/ssconvert/src/codecs/gnumeric-followup-independent.test.ts` using Vitest. Run the maintained `@poe-code/ssconvert` lint route after edits. Root owns the candidate revision, build, shared-engine integration, and broader gates; these checks do not certify those surfaces.

Use the separately installed Docker `colima` container `ssconvert-statistics-qa` only as the native QA oracle, with the captured profile in `docs/ssconvert/gnumeric-xml-reference-profile.json`. Keep original XML and native output under `out/gnumeric-followup-stress`. The primary source remains under `out/ssconvert-lifecycle/gnumeric-1.12.61`.

Execute the following independent controls:

- Construct all six margins with mixed-case unit aliases and foreign/unknown attributes. Check retained Points, canonical units, and dropped attributes.
- Place foreign Style/Font and unqualified drawing-only children inside a core style. Verify ordered unexpected-element diagnostics; independently retain valid unqualified drawing Style, line, and font data.
- Compare two gzip serializations byte-for-byte and separately compare inflated data with uncompressed output.
- Reject external entity references, a corrupted gzip checksum, pre-acquisition cancellation with exact reason identity, a zero cell budget, and a one-byte output budget for both serializers.
- Native-check a v14 workbook without Version, using unknown attributes on margin, Style, and Font. Distinguish the source `go_io_warning` callback from actual command stdout/stderr.
- Native-check children beneath sheet Name, where named-expression Name grammar must not authorize children. Preserve native descendant text accumulation while reporting the unexpected elements.
- Repeat sheet Name with interleaved namespaced/unqualified rejected descendants, nested text, CDATA, comment and PI. Check a coherent modern SheetNameIndex and reject an index containing only direct text. Check preabort with a foreign-realm Error reason independent of `instanceof Error`.

## Observed results

Six original unit cases passed on September 20, 2026; the last focused run took 27 ms of test time. The initial maintained lint run failed on this agent's test-only unchecked indexed XOR assignment. It was corrected, and the subsequent maintained package lint run passed, including source and test TypeScript checks. Root must qualify the final combined candidate after any further runtime edits.

Native v14 unknown margin/Style/Font attributes produced exit 0, no stdout/stderr, and disappeared from exported XML. The native exporter also synthesized missing margin/style/font defaults. Therefore missing command warnings for these attributes were not validated as an observable mismatch. Source-only warning callbacks cannot be treated as emitted CLI diagnostics.

Native sheet Name containing `<g:value>bad</g:value><value>worse</value>` emitted two stderr warnings in that order, each with `Workbook -> Sheets -> Sheet -> Name`, exited 0, and exported the sheet name `Sbadworse`. Root was informed of this concrete grammar collision before making its owned fix.

After root repaired the Name state collision, an independent mixed-content case passed: native preserved `ABCDEFGHI&`, emitted only the two top-level unexpected-subtree warnings in source order, and produced one correctly indexed sheet. The candidate matched that text and diagnostics and rejected a deliberately incoherent index. Comment/PI content did not enter the name; CDATA and nested rejected-subtree text did. Cross-realm preabort validation uses a host AbortSignal with a separately created foreign Error reason; it does not claim an independently created foreign AbortSignal implementation.

The final follow-up cohort contained eight tests, all passing (91 ms test execution under concurrent host load). The maintained package lint route was rerun after both newest tests and completed successfully. Runtime review of context propagation and ordered sheet-name text collection found no additional concrete defect in this focused surface. Cleanup ownership/acquisition ordering remains covered by the root's existing tests rather than independently established by this cohort.

## Delegated graph-property follow-up

Root later found delegated graph style loss on the official `object-tests.gnumeric` QA fixture and added a narrow property-state admission rule. Independently native-check original minimized GogGraph properties using `GogStyle`, `GOStyle`, and `InvalidStyle`. Native GogStyle produced no warnings; native GOStyle produced a GLib invalid-type warning followed by an unexpected `outline` warning; native InvalidStyle produced a GLib unknown-type warning followed by the same unexpected-element warning. Thus GOStyle cannot be treated as interchangeable with GogStyle for this graph property.

The independent GOStyle regression initially failed (eight passes, one failure), proving the false type authority. Root restricted the type admission. The expanded independent cohort then passed fifteen tests (35 ms): valid GogStyle retention plus invalid GOStyle, InvalidStyle, wrong/case-changed property names, qualified foreign type attributes, foreign outline namespace, and missing GogObject ownership all rejected as appropriate. Only the three native type variants were independently native-measured here; the other controls also follow the inspected native property dispatch and XML namespace grammar, but are not recorded as separate native matrix passes.

Native GLib invalid/unknown-type warnings include process identity and timestamps and remain additional unmatched diagnostics. The focused fix qualifies child retention/drop and unexpected-element warnings, not complete native object/property reflection, normalization, or diagnostics. Complete graph serialization and upstream QA remain root-owned, unfinished compatibility work.

The final graph-property cohort's maintained package lint run passed after all fifteen tests were added. Native captures were rerun with every environment entry from the captured reference profile and recorded in `out/gnumeric-followup-stress/native-graph-property-captures.json`, including exact argv, invocation, exit status, stdout/stderr, profile and fixture/output hashes. All three native variants exited 0; GogStyle emitted no diagnostics, GOStyle emitted 239 stderr bytes, and InvalidStyle emitted 244 stderr bytes in that capture. Original fixtures and XML outputs remain adjacent under `out` for the root's final receipt. Native GogStyle retained width 2.75 while synthesizing automatic style attributes; this does not establish canonical property byte equality.

## Limits requiring separate qualification

Negative/nonfinite margin Points, invalid font units, rotation/script normalization, synthesized complete default style regions, and byte equality against native deflate implementations remain unmeasured here. This cohort covers deterministic internal serialization, not full native byte parity or performance. It does not qualify CLI/SDK file workflows, host/realm authority, SafeJS original/checkpoint/replay, broad gates, screenshots, or all SAX attributes/elements. Native unknown-attribute callbacks and captured command channels have different observable behavior.
