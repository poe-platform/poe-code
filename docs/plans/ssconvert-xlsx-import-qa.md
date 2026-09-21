# XLSX importer implementation and QA procedure

Implement the `Gnumeric_Excel:xlsx` reader in the existing TypeScript ESM ssconvert package and register it declaratively. Use the office-package bounded ZIP/compression codec and injected byte I/O through the shared SDK/virtual command engine. Native Gnumeric 1.12.61 is a separate QA oracle only.

1. Verify the official source archive hash and inspect every stable reader declaration, included reader module, supported namespace and plugin descriptor. Acquire all primary sources only under `out`. Record source provenance and feature classifications outside this plan in `docs/ssconvert`.
2. Establish concrete failing original in-memory XLSX/template regressions before implementing the reader. Use memfs for file effects; never execute native utilities or write host files from unit tests.
3. Bound archive members, aggregate inflation, XML nodes/text/work, sheet/cell counts and OPC path resolution. Preserve owned bytes and cancellation reason identity. Resolve internal package paths without host or network access.
4. Implement workbook/sheets, shared strings, styles, date systems, formulas/caches/groups, names and measurable metadata. Compare warnings, ignored parts, ordering, protection and macro/binary/encrypted-container behavior with source and fresh native captures. Treat source-recognized nodes and raw metadata retention separately from implemented semantic parity.
5. Have a different agent stress the shared engine and add failing regressions for verified defects; coordinate product repairs. Root retains public export, package integration and Git ownership.
6. Run maintained uncached selected-workspace build closures, ssconvert unit/lint routes and appropriate safe-bash integration checks. For visually observable diagnostics, inspect an ad hoc screenshot. Reduce ephemeral captures to verified evidence and purge owned temporary fixtures/logs after use.
7. Record each verified coverage claim, known mismatch and unmeasured feature. No README changes, pushes or publication are authorized. Preserve all preexisting work.
