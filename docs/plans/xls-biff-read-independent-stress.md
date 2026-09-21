# Independent BIFF stress QA procedure

The independent stress agent owns this procedure and the original in-memory cases
in `packages/ssconvert/src/codecs/biff-stress.test.ts`. Root retains native oracle,
integration, maintained build/test/lint, exports and Git ownership. No native
process, LLM call or host-file write occurs in this unit suite; the SDK corruption
case uses memfs and injected byte I/O.

## Execute

1. Run the independent BIFF stress suite and existing BIFF regression suite against
   current source. Require every assertion to pass. Root additionally runs the
   narrowest maintained uncached workspace checks and cross-workspace checks.
2. Compare empty and absent formula STRING caches to the verified stable primary
   source `ms-excel-read.c`, `excel_read_FORMULA`: empty historical STRING records
   are strings; missing records produce `MISSING STRING`, with a warning.
3. Compare exact positive `-E` mappings to `gnm_xl_get_codepage`; zero entries and
   unmatched spellings do not override workbook codepages.
4. Compare older Name-token payload widths to `ms-formula-read.c`,
   `FORMULA_PTG_NAME`: BIFF2/3/4 use ten bytes, BIFF5/7 use fourteen, BIFF8 four.
5. Exercise malformed offsets, record headers/payloads, record budgets, CONTINUE
   width changes/rich runs, wide-character splits, oversized extension lengths,
   formula underflow/name indices/truncated references/work limits, and boolean
   and error caches in revisions 2/3/4/7/8.
6. Use original empty and mini-stream CFB fixtures to exercise FAT/root/miniFAT
   cycles, directory-tree cycles, invalid names/references/header layouts/counts,
   short sectors, and decoded-byte limits when two entries alias one large stream.
7. For separate native QA, import `originalMiniCfb` from
   `biff-fixtures.test-support.ts`, supply an original complete <=64-byte workbook,
   store generated evidence only in out, and compare native status/stderr/output
   and JavaScript SDK results. Native execution never enters product code or unit
   tests. Root must record the actual binary/plugin/dependency/locale profile and
   results; this procedure alone does not establish a native pass.

## Verified execution and repairs

Independent execution on 2026-09-20: 24 stress cases and ten existing BIFF cases
passed (34 total). The maintained package lint route also passed. This is a focused source run, not the maintained full workspace
gate. Original before-repair failures established empty STRING records (two
failures), absent STRING caches/exact encoding overrides (two failures), and older
Name payload widths (three failures). Narrow corresponding production repairs
made those cases pass. All other stress assertions passed without binary-primitives
changes. The corruption SDK case verifies its thrown `io` error, exitCode 1,
diagnostic message, and absence of an output file in memfs.

## Limits and unresolved measurement

This suite is not exhaustive opcode/revision compatibility or native differential
coverage. BIFF4W, advanced array/shared formula token semantics, external workbook
formulas, drawing/chart semantics and full XF/font/border inheritance are not
certified by these cases. DBCS workbook codepages and positive `windows-936` override remain
unsupported by the single-byte decoder until explicitly implemented and measured.
An empty CFB v4 root/directory count and a DIFAT cycle are exercised, but successful
multi-sector DIFAT chains and CFB v4 workbook mini-streams remain unmeasured. Encrypted workbook
decryption is unsupported; rejection is not a decryption pass. Native GLib warning
prefixes/process metadata and exact formatting are not certified by the source
warning assertion. Native round-trip outcomes belong to root's separate QA record.

## Follow-up metadata/group stress procedure

Execute `biff-metadata-stress.test.ts` and `biff-groups-stress.test.ts` alongside the
existing BIFF suites. Ten metadata cases exercise legacy NOTE comments exceeding
4096 bytes, continuation column validation, total semantic-text budget, empty
BIFF8 authors, empty headers, finite print margins, OBJ/TXO linkage and reset,
compressed/wide comment CONTINUE chunks, cancellation and ordered raw retention of
uninterpreted shape/chart records. Six group cases exercise invocation group
budgets, anchor ownership, ptgExp payload admission, unsupported-token preservation
without dangling public group ids, anchored array references/caches, and a string
cache following its intervening group definition.

The first six metadata cases and first five group cases each failed against the
new implementation before their narrow repairs. A subsequent group string-cache
case failed before its record-order repair. The stale OBJ-id regression separately
demonstrated text replacement from an unowned TXO before resetting ownership on
each OBJ. These are original in-memory cases; no host files or native utility are
used. Unknown-record retention assertions establish preservation and warning
ordering, not shape/chart interpretation. Native malformed-file diagnostics and
GLib formatting remain unmeasured. Successful rich-text comment formatting,
Escher geometry, all array-function evaluation, and encrypted decryption remain
outside this focused validation.

After the follow-up repairs, all six focused BIFF suites passed: 59 cases total
(24 original independent stress, ten existing BIFF, ten metadata stress, six group
stress, six existing group, three existing metadata). This is source-level focused
verification; root owns the final maintained uncached workspace gates and native
differentials.
