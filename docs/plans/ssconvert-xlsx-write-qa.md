# Both XLSX writer profiles

Root owns export wiring, SDK integration and Git. Preserve existing edits; no README edits, commits, pushes or publication. Execute QA as an agent; native utilities are separate oracles only. Primary source stays in `out` and must authenticate against the requested archive SHA-256.

1. Add an original in-memory failing SDK regression for both stable exporter IDs, profile-specific web-publishing attributes, formula/cache preservation and `.xlsx` default resolution. Use memfs for command file effects.
2. Audit upstream `plugins/excel/xlsx-write.c` and included style/drawing/chart/docprops/pivot handlers. Compare profile switches, selection behavior and dimensions. Capture oracle version, binary/dependencies/plugins/locale in owned `out/ssconvert-xlsx-write` scratch.
3. Implement bounded writers using existing package ZIP/XML capabilities, workbook model and injected cancellation. Keep command and SDK on the same engine.
4. Differentially inspect ordered uncompressed OPC parts, formula/cache XML and relationships. Reopen both profiles with native Gnumeric and an independent reader. Investigate XML and ZIP byte differences separately; do not erase semantic differences through normalization.
5. After implementation, assign a different agent to stress and repair writer-owned logic with failing regressions. Root keeps integration ownership. Review its findings and rerun narrow maintained uncached build/unit/lint checks, including safe-bash integration.
6. Record measured coverage and explicit unsupported/unmeasured cases in maintained verification evidence; never count them as passes. Reduce evidence before purging only owned temporary artifacts.
