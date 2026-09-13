# Live collection numeric lookup

Implement the shared SDK §4 distinction between nonnegative bracket positions
and explicit negative `.at` lookup for live chart collections and gradient stops.
Own `chart-model-core.ts`, `shapes.ts`, a new original collection regression file,
and this plan plus a bounded research receipt. Preserve all preexisting edits.

1. Reproduce negative bracket lookup through public exports with original XML.
2. Reject negative brackets without changing supported `.at` semantics or points.
3. Cover returned plots, series, categories, levels, points and gradient stops;
   account for relevant inventory identities and language mappings in research.
4. Run focused tests/lint and delegated CLI selector checks, then maintained
   `npm run build`, `npm test`, and `npm run lint` uncached. Record results here.
5. Commit only owned files on main after checks pass; do not push.

QA procedure: this mapping uses deterministic in-memory model inputs. It needs
no corpus download or renderer. Corpus/application evidence remains separate
from unit and maintained-check evidence; no visual-fidelity claim is intended.

## Execution

- Red: both new public-export tests failed on negative bracket reads.
- Green: focused four-file run passed 38 tests.
- `npm run test --workspace=pptx`: 269 files, 6,874 tests passed.
- `npm run lint --workspace=pptx`: passed ESLint and both TypeScript projects.
- Delegated safe-bash read-only review: no CLI changes required; supplemental
  chart inventory/editing execution passed 9 tests. This is not a maintained
  workspace-route result. The delegated worker owned no edits.
- `npm run build`: passed declared workspace closure and root suffix/bundle.
- `npm run lint`: passed ESLint (zero errors/warnings), type contracts and
  workflow lint.
- `npm test`: passed, exit 0, including native pre/event/post lifecycle stages.
  Shared group: 30,246 passes and two skips. Python workspace: 29 passes.
  Safe-bash runner: 499 passes; main suite: 37,901 passes and 823 skips.
  Safe-js: 28,932 passes and 47 skips. Terminal-pilot: 288 passes. Root posttest:
  two lint stress tests passed. Skips and unavailable profiles are not passes.
  The maintained plan reported 74 workspaces, five required builds, 43 declared
  test tasks, `cache: UNCACHED`, and no exclusions; no-declared-test entries
  retain `NO_DECLARED_TEST_NOT_A_PASS`.

The maintained runner clears Git-local variables in child environments and
scopes optional virtual-bash profile variables to that workspace. No cache,
exclusion flag, invented profile or substitute root-only route was used.

Corpus/application evidence: none; no downloads, renderers or shipped fixtures.
The research receipt preserves 13 relevant positional-case identities and their
existing exact-variant limitations; this correction establishes the JS numeric
boundary only, not complete API or source-parameter parity.

Status: implementation and all required checks complete. Ready for one local
atomic commit on main; no push or release authorized or performed.
