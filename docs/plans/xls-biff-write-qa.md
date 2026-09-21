# BIFF writer implementation and QA

Use original bounded in-memory workbooks and memfs. First reproduce missing exporters through the shared CLI/SDK; distinguish BIFF7 Book, BIFF8 Workbook and dual-stream DSF. Authenticate the official 1.12.61 source archive in out. Native utilities are separate QA oracles only. Preserve existing edits; no README edits, push or publication.

Implement revision-specific records and limits, CFB allocation/directory integrity, formula tokens and caches, strings, styles, metadata and dual-stream output in the responsible package. Validate diagnostics and publication failure behavior with injected capabilities and cancellation. Unit tests must not create disk files or spawn utilities.

After implementation, assign a different agent independent stress/fix ownership for writer tests and internal writer modules; root keeps provider registration, exports, integration and Git ownership. Execute native reopening and independent reader checks separately, including each DSF stream. Capture dependency/plugin/locale profile and report every unsupported or unmeasured case explicitly. Run maintained uncached workspace build/test/lint routes, plus safe-bash command coverage. Store temporary evidence in out and purge task-owned temporary logs after recording results.
