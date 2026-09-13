# Chart object and builder completion

Root owns chart operation integration, exports, verification and local commits.
Delegated owners: chart_objects owns live chart graph; chart_builders owns data
builders; drawing_format owns shared drawing behavior. Existing uncommitted media,
sanitization, spec and plan changes are outside this assignment.

Read the root instructions, PPTX and shared Office specifications and both API/test
inventories. Enumerate all documented members, including inheritance, defaults and
unsupported creation variants. Preserve those obligations in docs/pptx receipts.

Use original small tests before implementation; package tests use explicit memory
bytes and memfs, never publisher/reference assets. Reuse shared domain behavior.
Expose chart object mutations through schema-validated charts set operations,
with explicit selectors, JSON and atomic publication. Retain neutral model names.

Agent QA: run maintained PPTX tests/lint/build; inspect chart help screenshot;
review exact staged owned files; commit atomic improvements on main without push.
No README edits, native runtime, implicit network or host access in product code.

## Completed verification

- `npm test --workspace=pptx`: 6,292 tests passed across 236 files, no failures.
- `npm run lint --workspace=pptx`: ESLint, production TypeScript and test TypeScript passed.
- `npm run build:workspaces -- --workspace=pptx`: selected declaration-derived build closure passed.
- Scoped adapter owner read safe-bash instructions and ran
  `node scripts/test-reporting.mjs --import tsx tests/commands/pptx/chart-editing.test.ts tests/commands/pptx/chart-inventory.test.ts`:
  nine passed, none failed or skipped.
- Actual Shell with MemoryFileSystem and explicit engine: `pptx charts set --help`
  exited zero, stderr empty, and advertised `--objects`.
- Generic maintained screenshot route captured engine help; inspected
  `.cache/pptx-chart-object-help.png`. Legible, bounded lines and correct new flag/index help.
  The first capture occurred during an in-progress edit and was replaced after
  the finalized code passed. No screenshot or disposable executable is committed.
- Independent review supplied failing tests for cache duplicates, owner invalidation,
  numeric indexing, drawing owner boundaries, accessor admission and schema/model
  bounds; all pass after fixes. Exact historical fixture payload equivalence is
  explicitly uncertified, not silently counted as a TypeScript pass.

Delivery consists of separate local code improvements for all-variant classification,
shared drawing behavior, and integrated chart objects/builders/commands. Root stages
only owned files and owned command-engine/index hunks, preserving unrelated work.
No README edit, push, release, publisher fixture commit or source-runtime execution.
