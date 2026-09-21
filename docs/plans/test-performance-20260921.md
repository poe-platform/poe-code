# Test performance work, 2026-09-21

Requested window: two hours, starting 13:17 UTC. Preserve all existing tests and their resource/cancellation assertions.

1. Commit the pending DOCX fixes, tests, plans and audit evidence explicitly.
2. Measure the full DOCX suite and its expensive files using the existing workspace command.
3. Add exact workspace selection to the maintained root unit runner. Preserve uncached execution, declared dependency builds, native npm hooks, environment scoping and cleanup. Keep the default complete suite.
4. Add change-based selection only when the graph can conservatively retain affected consumers and shared infrastructure falls back to the complete suite.
5. Reduce real scheduler overhead without replacing document parsing, archive validation or event-loop cooperation with mocks. Validate cancellation and portable host behavior.
6. Run maintained tests and lint, compare equivalent DOCX cases, document commands and measurements, and commit each atomic improvement.

Initial evidence: the unit argument parser rejects `--workspace`; its plan schedules every declared workspace even with a DOCX path filter. The five pending regression files pass 472 tests in 47.59 seconds, with 75.07 seconds of summed file execution at two workers. ZIP reads/writes call a zero-delay timer for every member and payload chunk.

Pending work committed: `505193e84`, `42e9d0ab8`, `537b96b8a`, `19df50be2`.

## Scope selection

`npm test -- --workspace=docx` now selects only the declared DOCX task. Repeat exact workspace names, or select root with `--workspace=.`. `--changed-since=<ref>` compares staged/tracked working-tree content and untracked files against a verified commit, retains reverse declared dependency consumers, and falls back to all tasks for shared or unknown inputs. `--dry-run` reports planned tasks without claiming passes. Shared runs preserve selected phases and avoid root discovery when root is not selected.

Validation so far: 324 runner tests including native lifecycle/process checks; 62 focused scope/shared/scanner tests; 284 lint guard checks, plus the maintained root posttest stress checks. The default complete suite is unchanged.

## Cooperative scheduler

ZIP and document work now use a real Node immediate turn rather than a minimum-delay timer. Portable hosts retain the timer fallback. All work thresholds, accounting, cancellation checks and codec validation remain in place.

Equivalent five-file benchmark: 472 passes before and after; 47.59s wall / 75.07s summed file time before, 13.25s wall / 18.50s summed file time after. Approximately 72% less wall time. Runs were not isolated from other host processes; use this as a representative local comparison, not a CI guarantee. No cases removed and no timeout changes.

Scheduler/ZIP/compression/budget validation: 81 passes. Portable browser bundle validation: two passes. DOCX dependency build: five declared builds, uncached. Package lint and root type/workflow lint pass.

## Findings from broader validation

- Root ESLint stopped at its finite 16,000-subject ceiling (`subject cap`), not an ESLint rule error. A failing guard test reproduced the inability to admit 16,001 subjects. The new ceiling is 24,000; byte/metadata/entry limits and caller-lowered limits remain unchanged.
- The complete run reproduced 48 outdated canonical field assertions: compatibility-wrapped native PAGE fields were expected to reject edits, although those carriers are already admitted by current code. Tests now exercise successful edits and retain assertions for inactive INCLUDETEXT branches, wrapper spelling, unchanged non-dirty parts and input bytes. Inert fields still reject. Shells are disposed at test completion. The 320-case canonical matrix passes.
- One 5-second test timeout occurred during overlapping full runs/builds. Duplicate full DOCX work was stopped. The final complete suite runs alone; no test timeout was increased.

## Shared helper scope follow-up

An isolated root script test edit now schedules root only. Package test helper/fixture changes fall back to all tasks, because tests may import helpers across package ownership boundaries. The prior committed selector returned only root + DOCX for `packages/docx/tests/fixtures/text.ts`; a replay of the prior pure selector reproduced that result. Focused scope/scanner/routing checks pass 28 tests, plus root posttest stress.
