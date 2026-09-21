# Statistics, distributions, randomness, time series and queueing QA

Use Gnumeric 1.12.61 from the archive with SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary sources and temporary evidence stay under `out`. The native binary is
only a separate QA oracle. Preserve its dependency/plugin/locale profile.

1. Reproduce missing implementations with original in-memory workbook fixtures.
   Record the failing regression count before implementing.
2. Inspect all five plugin descriptor tables, collection policies and numerical
   helpers. Register fixed/node arities, aliases and source-specific errors.
3. Verify each deterministic family with original small cases, domain boundaries,
   array layouts, tail/log probabilities and numerical limits. Compare numeric
   values before serialization; distinguish tolerance and exact equality.
4. Inventory every upstream accuracy case; mark cases not executed as unmeasured.
   Do not count unsupported domains or skipped cases as passes.
5. Verify injected randomness without ambient state. Compare distribution quality
   and native seed behavior separately: equal seeds do not imply equal streams
   across different algorithms. Test cancellation and operation/cell limits.
6. Exercise the shared SDK and virtual command with byte I/O, VFS, statuses,
   diagnostics, namespace effects, replay and cancellation.
7. After implementation ask a different agent to stress and fix this scope.
   Root owns integration/export/Git changes. Record defects and residual limits.
8. Run maintained uncached package and cross-workspace build/test/lint checks.
   Record actual results, verification limits and remaining mismatches.

No README changes, push, publication or native product fallback are authorized.
