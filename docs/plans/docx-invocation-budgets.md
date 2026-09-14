# DOCX invocation budgets execution record

Scope: only `limits-and-work-accounting` from the DOCX pipeline. Later tasks,
including streams/cleanup, model APIs, command registration, batch and diff,
remain pending. The concurrently edited pipeline and unrelated archived plan
were preserved without staging their changes.

## Red/green evidence

The first seven original regressions failed before implementation because shared
host/operation limits, invocation counters and cooperative XML parsing did not
exist. Existing primitives also lacked charged editor copies. Subsequent failing
regressions established missing retained XML attribute/content counts, missing
table dimension enforcement, allocation after cumulative output exhaustion,
noncooperative metadata parsing, lost context cancellation, uncharged
compatibility traversal, incomplete lowered XML work accounting, and uncharged
creation nodes, returned package allocation/traversal bypassing the ledger, and
encoded path allocation before writer retention admission.
Each was implemented only after its failing run.

The original archive/XML/package/semantic tests remain intact. New tests use
small original documents and memfs for filesystem mutation. No downloads, native
reference build, product networking, giant expansion fixtures or timeout-based
acceptance were used. The shared ledger's batch/match counters and two-document
scopes are tested as infrastructure; later operations are not claimed built.

## Implementation

- Add immutable trusted ceilings, lower-only operation views and shared counters
  under `packages/docx`; preserve explicit legacy codec host configuration.
- Charge input, expansion, copies, XML, creation, output and work across existing
  entry points; retain cancellation and original API names/return types.
- Cooperatively parse metadata and XML parts on async admission; keep model-only
  calls synchronous with finite counters. Publish precise accounting limits and
  the distinction from RSS isolation in `docs/docx/resource-limits.md`.
- Keep the whole API audit and research discrepancy dispositions pending where
  implementation is pending. Update validation documentation only for changed
  resource behavior; do not relabel research coverage as product coverage.

## Maintained checks

- `npm test --workspace=docx`: 386 tests passed in 12 files, including 17 new
  budget regressions. Existing test names and fixtures were preserved.
- `npm run build:workspaces -- --workspace=docx`: passed the maintained selected
  dependency closure (docx, office-package and safe-fs).
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript checks passed.
- Built ESM import smoke: the budget and cooperative XML exports passed.
- `git diff --check`: passed. No visual CLI surface changed, so no CLI screenshot
  route was applicable. No cross-workspace product files were changed.

The bounded resource foundation is implemented and validated. Later pipeline
tasks remain pending. No push, release, broad staging or ignored QA fixtures are
authorized.
