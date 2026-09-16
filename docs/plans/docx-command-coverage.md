# DOCX command coverage task record

Task: `map-all-features-to-commands` only.

Date: 2026-09-13. Branch: `main`. Local commit only; no push or release.

## Ownership

- `docs/docx/command-coverage.json`
- `docs/docx/command-coverage-notes.md`
- This task record.

Root AGENTS.md applies; no scoped AGENTS.md exists under docs. The DOCX and
shared Office CLI/SDK specifications, both API/test audits and full JSON
inventories, and the existing public API map/review were read. The pipeline
plan and unrelated plan move already had changes and remain untouched. A
separate owned task record avoids including that work in this commit.

No README, product code, test code, shared specification, inventory, binary or
package configuration belongs to this task. No reference runtime, renderer,
network acquisition or corpus cleanup is authorized by this documentary task.
Later tasks remain pending; their implementation states are not advanced here.

## Agent QA procedure

This is an agent-executed procedure, not a committed QA script.

1. Confirm main and capture existing changes. Read root/scoped instructions and
   all task authorities/evidence. Verify the required register is absent with a
   failing read-only assertion before creating it. This is documentary evidence;
   product TDD is inapplicable because this task changes no code.
2. Parse both inventories and the API map. Account for every F01–F50 row, all
   920 reconciled IDs, all 1,337 API-map rows and 262 expanded enum values.
   Retain the unchanged source-test adaptation states and provenance hashes.
3. Review ordinary command grammar, direct flags, selector scope, typed options,
   operation IDs, schema/help, JSON, exit statuses, publication and security
   against the shared contracts. Review preservation-only subsets separately
   so inventory/extraction does not imply editing.
4. Review inherited/underscore/returned types, static factories, getters/setters,
   index/slice/keyed protocols, unit/color helpers, enums and guide workflows.
   Validate exact argument/default/return links and static versus live receivers.
   Resolve contradictory provisional API routes in the new command register;
   retain earlier research and record each correction's evidence.
5. Check every operation/test/API reference and JSON pointer. Check closed IDs,
   no branded executable IDs, no unknown direct routes, split get/set/slice
   signatures, direct common edits and the complete typed batch example.
   Ensure all target tests remain planned with no fabricated implementation path.
6. Run the maintained repository formatter scoped to the three owned files,
   validate local Markdown links, and run git diff whitespace checks. Runtime
   build/unit/ESLint and visual CLI gates are inapplicable to documentary data;
   they must not be reported as passing tests.
7. Inspect the owned diff and index, stage only these three files, and make one
   Conventional Commit for this atomic coverage register/review/task record.
   Verify commit contents and report the local hash. Never push or release.

## Execution evidence

- Pre-edit assertion failed: `Missing required DOCX command coverage register`.
- Created the register and review without changing product code or inventories.
- Reviewed the existing 23 documentation/source decisions and recorded eight
  concrete command-contract corrections, including static receiver and slicing
  coverage. No runtime implementation defect is claimed fixed.
- Mapped 50 format features and 1,337 API rows, including all 920 inventory IDs
  and 262 enum values. Target evidence remains zero implemented/zero passing.
- Original feature cases and per-member acceptance specifications remain
  planned. All 2,259 source cases remain unadapted, and no downloaded binary or
  publisher text becomes a canonical fixture.
- Final register: 113 direct operations, 1,393 typed batch operations, and 1,538
  planned acceptance records. Five batch operations address additional format
  behavior beyond the documented reference model. Counts do not imply passes.
- Structural checks passed for feature/API/enum accounting, all operation/test
  references, linked model JSON pointers, input evidence hashes, common option
  references, split index/slice and XML get/set forms, static receivers, and the
  advanced batch example. All input inventories and their statuses are unchanged.
- Owned local Markdown links resolve. The scoped maintained formatter command is
  `npm exec --no -- prettier --check docs/docx/command-coverage.json docs/docx/command-coverage-notes.md docs/plans/docx-command-coverage.md`.
  No package installation or network resolution is needed. Git whitespace checks
  passed. Product build/unit/ESLint/runtime/corpus gates are inapplicable and are
  not claimed as passes. No CLI output or visual implementation changed, so no
  screenshots are applicable.
- Local commit contents/hash are verified at delivery; this record deliberately
  does not embed its own hash. Unrelated changes remain outside the commit.

## Delivery boundary

This task completes the documentary command map only. Product schemas/help,
implementation, failing original unit tests before code, safe-bash integration,
packed consumers, visual/corpus qualification and source-test adaptation remain
later tasks. No push, release or disposal of QA material is performed.
