# DOCX public API map task record

Task: `define-mirrored-js-api` only. Date: 2026-09-13. Branch: `main`.
Documentation/research only; local commit, no push or release.

## Ownership

Owned files are `docs/docx/public-api-map.json`,
`docs/docx/public-api-map-review.md`, and this record. Existing edits to
`docs/plans/docx-typescript-safe-bash.md` and the unrelated plan move remain
untouched. No README, product code, configuration, source test inventory,
reference binary or shared specification is changed.

Read root AGENTS.md; no scoped AGENTS.md exists under docs. Read the DOCX and
shared Office CLI/SDK specifications, both API/test audits and complete JSON
inventories, and the preceding reconciliation evidence. The maintained initial
331 records are historical: the current inventory contains 920 records and 262
nested enum values. Neither count is a closed conformance denominator.

## Agent QA procedure

1. Before writing the map, assert its existence and required mapping surface.
   Record the failure. This is documentary failure evidence; product code is
   prohibited, so do not write product tests or implement later tasks.
2. Verify pinned documentation/source hashes, parse all source-test records,
   and preserve their adaptation status. Inspect unannotated return/setter
   contracts against source. Resolve asymmetric types explicitly.
3. Account for all inventory IDs, each enum value, inherited and returned
   protocols, named source errors, safe view operations and guide workflows.
   Check each row has a revision, concrete target signature, argument/default
   contract, separate getter/setter, ownership, effects, errors, CLI route and
   original acceptance specification. No passing evidence may be fabricated.
4. Parse target declaration syntax with the installed TypeScript parser. Check
   JSON uniqueness, count consistency, enum values/aliases and local links.
   Review async admission/save versus synchronous live-model behavior, keyed
   lookup, sequence bounds/slices, null/false/zero, units, dates, byte ownership,
   explicit capabilities, invalidated handles and CLI schema/selector conventions.
5. Run the installed maintained formatter against only owned files, followed by
   `git diff --check`. Product lint/build/tests and CLI screenshots are not
   applicable to documentation-only changes and are not claimed as passes.
6. Review the index and explicitly stage only the three owned files. Commit one
   atomic API-map improvement on main with Conventional Commits; no coauthor or
   bypass flags. Verify commit contents and remaining unrelated work. Report
   the local hash separately from delivery/release; neither push nor release is
   authorized. All later tasks remain pending.

## Execution

- Pre-edit assertion failed: `required public API map absent; no per-member
TS/CLI/original-case mapping`. No product code followed this check.
- Parsed all 920 API records, 1,609 unit variants and 650 expanded BDD cases;
  no source-test adaptation status changed.
- Verified all recorded documentation/source hashes against the existing pinned
  checkout, without importing or executing that project. Inspected source
  declarations and read/set semantics for unannotated and drift-sensitive APIs.
- Expanded the map to 1,337 distinct rows. Coverage accounting includes all 920
  inventory IDs, 262 enum values, 128 enum metadata/type protocols, ten bounded
  view members, eleven guide workflows and six neutral error mappings.
- Each row has an original acceptance case specification. These are planned,
  unwritten cases, not passing tests. Future code owners must first observe
  failing original tests and then implement behavior. All 2,259 source cases
  still require detailed adaptation in their later task.
- Research corrections include nullable latent defaults/load count, nullable
  next-style reset, explicit relationship keyed versus nullable lookup without
  parallel aliases, and shared `allowEmpty` precedence over stale `allowMissing`
  wording. Comment `id`/`date` remain rejected documentation errors.
- No network acquisition, native/reference runtime, renderer, downloaded
  document campaign or cleanup was performed. Existing disposable inputs remain
  available for later authorized QA. Meaningful cases must be reduced into
  original small unit tests before their campaign closes or inputs are cleaned.
- Structural checks passed for 1,337 unique complete rows, all 920 inventory
  IDs and 262 enum values, declaration/return-type parse syntax, mapping/error
  references, all twelve guide topics, pinned source hashes and the unchanged
  2,259-case test inventory. Zero rows claim implementation or passing behavior.
- The scoped maintained Prettier check and `git diff --check` passed after
  formatting the final JSON. No owned file is ignored. Product checks and
  screenshots remain inapplicable and were not run.

## Result

The API-map documentation task is complete when the structural and maintained
format checks recorded in the companion review pass. This does not close any
product behavior or establish full conformance. Test adaptation, product code,
command implementation, corpus execution, cleanup, publishing and releases remain
pending. No read-only or empty commit is required.
