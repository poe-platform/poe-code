# Current BIFF candidate QA

Preserve the existing BIFF implementation, source inventories, evidence and unrelated edits. No README edits, pushes or publication. Native ssconvert is a separate oracle, never a runtime dependency.

1. Authenticate the Gnumeric 1.12.61 source archive in out against SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Inspect `excel_builtin_name` and `excel_read_name_str` in stable `ms-excel-read.c`.
2. Before changes run original byte regressions for all fourteen built-in identifiers in BIFF7/8, Unicode width and built-in suffixes. Keep a separate ordinary-name negative control. Tests run in memory; file effects use memfs.
3. Execute separate native imports of compressed and wide suffixed built-ins, ordinary names and native BIFF7/8 round trips. Capture version, binary/plugin/dependency identities, locale, exact diagnostics and semantic results in owned `out/xls-biff-read-current`. Compare names as well as values and formula caches; replay candidate XML in native. Do not infer parity from exit status alone.
4. Assign a different agent independent stress/repair of current binary/name boundaries and cancellation/budgets. Root retains integration, export and Git ownership. Wait for settlement, then check the exact resulting candidate.
5. Run fresh package test/lint and maintained uncached selected Safe Bash build closure. Execute the maintained selected ssconvert virtual-command suites covering SDK, memfs namespace preservation, corruption rollback and replay. Full repository gates remain unverified when only the focused codec changes.
6. Inspect an actual virtual-command importer-list screenshot. Record passes, failures, unsupported cases and unmeasured runtime cells separately, including existing encryption/drawing/chart/style/diagnostic mismatches. Hash the final candidate source and evidence; reduce and purge only owned disposable scratch.
