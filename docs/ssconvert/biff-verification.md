# Excel BIFF import verification

The TypeScript ESM `ssconvert` engine imports raw BIFF2/3/4/5-or-7/8 and bounded CFB Workbook/Book streams. `Gnumeric_Excel:excel_enc` remains a separate priority-200, nonprobe importer. Encoding, byte I/O, cancellation and virtual-command execution use the same SDK engine; native ssconvert is only a separate QA oracle.

[The receipt](biff-verification.json) captures the authenticated Gnumeric 1.12.61 source, native dependency/plugin/locale profile, original fixture bytes, measured results and remaining mismatches. [The source inventory](biff-source-audit.json) includes all 330 defined opcode values, 148 reader case labels, supported revision selectors and 381 formula function descriptors. Every defined opcode has an implementation disposition. Recognition or byte retention is not semantic coverage.

The previous receipt records 159 files / 4,218 tests and package lint/typechecks, 18 uncached selected Safe Bash builds and 52 command integration tests. [Current follow-up verification](biff-current-verification.md) records the subsequent NAME repairs, final candidate hashes, fresh checks, independent stress, native replay and the failed Safe Bash typecheck prerequisite. Full root and full Safe Bash gates are unverified; selected direct-file ESLint is not the guarded root lint route.

Native comparisons measured small original BIFF revision/CFB fixtures, valid workbook codepages, DBCS and encoding selection, plus native-generated BIFF7/8 round trips. Native reimports of the two candidate XML outputs exited 0 without diagnostics. Matching cells/formulas/merges does not imply matching styles, names, geometry, warnings or all metadata.

Full Gnumeric compatibility remains incomplete. Truncated-record recovery and diagnostic envelopes differ; encrypted inputs are rejected without native decryption. Invalid-XF labels differ. Drawing/chart/VBA/pivot/validation and other unsupported records retain original bytes with explicit loss reporting rather than reconstructing their contents. External references, style inheritance, implicit names/default geometry and uncommon revision/encoding combinations have incomplete or unmeasured coverage. The receipt lists these limits separately; none count as passes.

QA and independent stress procedures are in `docs/plans/ssconvert-biff-import-qa.md` and `docs/plans/xls-biff-read-independent-stress.md`. No README edits, commits, pushes or publication were performed.
