# Format provider registry QA

Use the official Gnumeric 1.12.61 archive with SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Acquire and extract primary source only under task-owned `out` scratch.
The native executable is a separate QA capability, never an implementation,
dependency or fallback. Preserve existing captures and unrelated changes.

1. Read root/scoped instructions and inspect Git status. Reproduce extension-only
   importer discovery and rejection of separate opener/saver entries sharing an
   ID with original in-memory regression fixtures before editing implementation.
2. Review `src/workbook-view.c` discovery, GOffice 0.10.61 `goffice/app/file.c`
   registration/default/scope ordering, `go-plugin-service.c` manifest defaults,
   libgsf 1.14.53 extension handling, XML's `.xml.gz` name probe, STF's interactive
   importer/noninteractive saver, and all format plugin manifests.
3. Independently compare the built source register to all 40 archive manifest
   opener/saver declarations. Account for the eight core registrations separately.
   Check IDs, descriptions, extensions/MIME and policy fields; do not substitute
   source declarations for installed implementations or qualified formats.
4. Run original small byte fixtures through competing name/content probes and
   independent `.xls`, `.xlsx`, `.ods`, `.html`, `.tex`, `.xml` saver expectations.
   Verify casing, basename boundaries, compound suffixes and forced IDs. Use
   memfs for conversion effects, and verify failures preserve bytes/namespace.
5. Run shared CLI/SDK and actual Safe Bash invocation controls. Verify listing
   ordering, native widths and stderr routing, selection status/diagnostic
   precedence, injected option handlers, byte budgets and cancellation identity.
   Unit tests must not spawn native tools, query LLMs or write real files.
6. Have a different agent stress/fix the implemented registry. Root retains
   engine, exports, integration, documentation and Git ownership. Reproduce and
   fix only concrete failures, then rerun affected checks.
7. Run narrow maintained uncached workspace tests, selected uncached Safe Bash
   dependency build closure, package lint, focused integration lint/runtime and
   maintained integration-membership/typecheck checks. Record failures accurately;
   a focused compiler pass cannot replace a blocked maintained gate.
8. Capture and inspect actual virtual-command terminal output using the built
   public engine/adapter and original injected fixture implementations. Store
   screenshots under `out`, with no screenshot tests. There is no root poe-code
   ssconvert subcommand; do not invent one for screenshot-poe-code.
9. Compare retained native C/UTC listing bytes separately from source Unicode
   descriptors. Record encoding, whitespace and unavailable oracle differences.
   Record all unavailable providers and unmeasured real-format/probe/option/replay
   cases as blockers, never passes. Reduce evidence into `docs/ssconvert`, remove
   task-owned scratch only, and do not edit READMEs, push or publish.
10. Independently check Unicode plugin extension folding against
    `go-plugin-service.c` (`g_utf8_strdown`), separately from the core XML ASCII
    probe. Compete `.WK1` and `.wK1` against a higher-priority content-only opener;
    reject fullwidth letters, longer suffixes, parent-directory names and trailing
    dots. Repeat with invalid content, falsey cancellation reasons and foreign-
    realm reasons. Withdraw incorrect test expectations when primary source
    disproves them; do not count a harness defect as a product defect.
