# csvstat user stress QA

Run the original frozen csvkit 2.2.0 / CPython 3.14.2 observations through the
actual registered safe-bash shell, using in-memory stdin/VFS and the captured
formatter lookup. This checks shell argv quoting, registration, source-check
precedence and exact stdout/stderr/status for the existing 241 observations.
Native programs, network, database services and host file creation are excluded
from canonical tests. Root recreated `out/csvstat-user-reference/bin/python`
with the frozen CPython binary and hash-locked dependencies for research only.
Twelve additional argument observations were measured there under C/UTC, plus
the exact formatter observation `%.3f`, Decimal `1`, grouping true => `1.000`.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvstat-user-edge.test.ts`.
2. Require exact stdout/stderr/status for every captured case, including all
   operations/types, empty/all-null/singleton data, formatting, frequency ties,
   selection, conflicting flags and serializer indentation.
3. Require stdin execution to create no VFS files. Check reordered zero-based
   selectors with one-based labels and exact redirected output without changing
   source CRLF bytes. Check CSV/JSON precedence in an actual csvcut pipeline,
   including Unicode column names and missing/inapplicable metrics.
4. Report concrete failures to the root production/integration owner before
   production changes. The root owns discovery registration and broader checks.
5. Keep unmeasured arbitrary locale/TTY/codec/shared parser cases explicit
   blockers. Existing source observations do not establish all-input parity.

No production edits, README additions, staging, commits or publication are part
of this independent review assignment.

Outcome: all 255 registered-shell tests pass (241 original frozen observations,
12 newly measured argument cases and two VFS/pipeline assertions), with no
skips/TODOs. Fresh cases cover duplicate/reordered selectors, an invalid empty
selector, skipped-all-input count, BOM on count/names/CSV, line-number semantics,
CSV/JSON precedence with negative frequency count, literal frequency strings
containing quotes/backslashes/newlines, names/conflict precedence, headerless
names rejection and variadic null-value argument termination.

The first run exposed a test fixture's incorrect readdir assumption; the VFS
returns directory entries rather than names. A later run reported a missing
formatter observation for Decimal `1`, not a product discrepancy. The reference
formatter value was measured before adding it to the injected table. No product
fix was necessary for these cases. Focused ESLint also passes.
