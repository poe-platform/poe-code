# Complete document test accounting QA

Own only `audit-upstream-test-completeness`. This is documentation/research;
product corrections and later pipeline tasks remain pending. Preserve the
historical research receipts. No README edits, fixture deletion, push or release.

1. Read root/scoped instructions, `docs/specs/docx.md`, the shared office CLI/SDK
   contracts, both crosslinked test audits and the document API audit/inventory.
2. Compare all pinned unit IDs and expanded BDD `(file, line, name)` identities
   with `test-case-map.json`. Reject missing, duplicate and orphan rows using
   negative controls. Preserve complete parameter/observation and expanded-step
   witnesses; do not reduce a row to its title.
3. Resolve historical and current scoped overlays by exact crosswalk pointer or
   identity. Record every overlapping overlay rather than selecting a favorable
   status. Distinguish architectural substitutions, intentional contract changes
   and deferred public behavior; none supplies a blanket exclusion.
4. Run maintained `npm test --workspace=docx -- --no-cache --reporter=json` and
   the matching office-package workspace test, with invocation-owned output under
   `out/`. Run maintained workspace lint. Capture source hashes during execution
   and compare afterward; report this timing rather than claiming a frozen input.
5. Retain a compact original execution catalog in `docs/docx`. Match named
   original tests by file and title. Parameter-template/family associations are
   candidates unless exact bound expectations have been reviewed. Passing tests
   establish execution, not every source variant or complete BDD workflow.
6. Link original security, preservation and small budget/profile reductions to
   actual results. Keep historical large-file measurements separate from fresh
   unit execution; no new large-document or renderer campaign is implied.
7. Retain all public API obligations, including inherited members, enums,
   collections, helpers, untested members and documented underscore-prefixed
   types. Record precise JS/security rules and documentation drift separately
   from source-case execution. Deferred public behavior blocks parity.
8. Validate JSON/pointers/counts, format owned documents and run `git diff
--check`. Commit explicitly named owned evidence and this plan on main with a
   Conventional Commit. Remove only invocation-owned temporary outputs after
   retaining concise provenance; leave disposable corpus/clone fixtures intact.

The [historical report](../docx/upstream-test-completeness.md) and
[dated requalification](../docx/upstream-test-completeness-20260921.md) distinguish
complete accounting from incomplete behavioral acceptance. Reference identities
and derived research stay in research/plans with standalone legal notices;
canonical original tests must not depend on these maps or QA inputs.
