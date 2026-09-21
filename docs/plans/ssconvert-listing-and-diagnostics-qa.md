# ssconvert listing and diagnostics QA

Execute this procedure as an agent. Native ssconvert is a separate QA oracle,
never a dependency or fallback. Root owns engine, CLI, adapter, exports,
integration and Git. A different agent owns independent stress tests and
validated repairs assigned to it. Do not edit READMEs, push or publish.
Keep scratch only in `out/ssconvert-listing`; reduce results into
`docs/ssconvert/listing-and-diagnostics-verification.md`, then purge owned scratch.

1. Preserve the dirty worktree. Read root and safe-bash instructions. Download
   the official unchanged Gnumeric 1.12.61 archive only into owned scratch;
   require SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`
   before extraction. Authenticate GOffice 0.10.61 against the captured profile.
2. Inspect source contracts: `ssconvert.c` listing, exporter/importer selection,
   option handling, loading, range/update, subset/split, merge and action/status
   order; `workbook-view.c` import/export diagnostics; GOffice key/value parsing,
   URI conversion and error-info printing; `workbook.c` merge-name suffixes.
   Bind comparisons to the dependency/plugin/locale profile in
   `docs/ssconvert/reference-profile.json`. Its incomplete optional-format gates
   remain incomplete. Source-based checks are distinct from native measurements.
3. Before implementation, execute failing original in-memory/memfs regressions
   for image enum ordering, UTF-8 byte ID ordering, warnings, verbose selection,
   fd stdout, sink failures, diagnostic/error stages and URI wording. Preserve
   failures beside subsequent passes until results are reduced. Do not spawn
   native utilities, query LLMs or create disk fixtures in unit tests.
4. Implement through the shared SDK engine and CLI. Keep injected byte I/O,
   cancellation, cleanup, budgets and owned bytes. Preserve domain statuses,
   including exporter-inference status 2; let opaque host failures escape.
   Check empty/hidden-only lists, ASCII/UTF-8 widths, action precedence,
   unknown IDs, missing destination/type, invalid syntax/range/update,
   unsupported subset/split, loading errors and known filesystem failures.
5. Exercise actual SDK and virtual Shell with original small CSV-shaped and
   binary fixtures: data goes only to stdout for `fd://1`, warnings go only to
   stderr, bytes are exact, and no fd-named VFS entries appear. Simulate stdout
   and stderr sink failures independently of subprocesses. Verify failure
   precedence, no stderr retries, cancellation reason identity and diagnostic
   budgets/copying. Exercise actual basic merge notices and source-order loading;
   reject records requiring unsupported reference rewrites rather than dropping
   them. Check native duplicate-sheet naming and dimensions separately.
6. Ask a different agent to stress/fix the implemented tool after implementation.
   Assign source/test ownership explicitly. Require a concrete failure before
   each repair. Root retains exports/integration/Git ownership. Recheck relevant
   package tests and lint after validated repairs.
7. Run the maintained selected uncached workspace build, package test/lint and
   focused virtual-command suite. Because the adapter crosses workspaces, also
   run maintained `npm test -- --no-cache` and repository lint routes. Respect
   declared task closures and hook-environment isolation. Distinguish a completed
   command from a partial log, skips, unavailable profiles and unsupported cases.
8. With the built public engine/virtual command, compare status and each channel
   byte-for-byte against the four authenticated captured version/listing cases.
   Bind the 19-importer/26-exporter activation fixture independently to oracle
   captures, not the registry under test. Mock codec activation proves listing
   metadata, not native format conversion. No fresh native invocation is implied.
9. Capture actual built virtual-command output with the maintained screenshot
   tool using an owned scratch fixture host. Inspect alignment, descriptions,
   verbose text and failure/status rendering visually. This is ad hoc visual
   verification, not a screenshot test. Record hash and inspection before purge.
10. Record exact coverage and every known remaining mismatch or unmeasured cell.
    Keep optional plugins, Unicode classifications, full transform/reference
    grammar, native sink/errno variants and richer merge semantics explicit.
    Unsupported/unmeasured cases are not passes. Preserve all unrelated edits.
