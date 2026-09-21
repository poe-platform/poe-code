# Bounded multilevel list utility

Scope: F18 original TypeScript utility, `lists.add` and `lists.set` only.
Later level-definition setters, live numbering construction and whole-public-API
coverage remain pending. Historical research/inventories remain unchanged.

## Behavior and continuation

The existing editor creates nine bounded ordered/bulleted levels, resolves
paragraph/numbering styles through owning relationships, reserves abstract and
concrete IDs separately including dangling references, and isolates restart
instances from other lists sharing an abstract definition. Complete matching
definitions can be reused; matching formats alone do not establish equivalence.
Mixed styles share an instance only when the changed level is unused and complete
generated semantics match. Picture resources and unsupported schemes remain
opaque and survive unrelated edits.

The September 21 continuation rejects nested extensions in scalar numbering
properties and opaque linked-definition content before following style links.
These semantics must not be discarded while materializing restarts or guessed
when continuing lists. Five original memfs regressions failed before source
changes and passed afterward. They verify unrelated preservation and resolved
paragraph/instance/level/override graphs rather than tag existence.

## Exact language/security mappings and drift

| Surface | Mapping |
| --- | --- |
| Utility | Always-async `editDocumentLists(bytes, request, context)` accepts admitted `Uint8Array` and explicit byte sink/VFS authority, cancellation and cumulative budgets. No ambient host I/O, clock, fonts, product networking or reference execution. |
| CLI/SDK | Plural `lists.add`/`lists.set` share validated schemas and one editor. JSON uses camelCase options and CLI uses kebab-case flags. Explicit publication or dry-run is required. Existing command-engine parity compares serialized SDK/CLI output. |
| Selection/values | CLI paragraphs are one-based; levels are integers 0–8; starts are nonnegative safe integers. Shared match/inserted-node budgets bound items. Model collection indexes remain zero-based. |
| Failures | Ambiguous, missing, cyclic or unsupported affected graphs fail before publication with existing stable categories. Opaque scalar/link extensions produce `unsupported-edit`. Unrelated opaque schemes remain preserved. |
| Public API | `NumberingPart`, returned `_NumberingDefinitions`, `_NumberingStyle`, inherited Part/XmlPart/style members, enums, collections and helpers retain separately recorded obligations. Public underscore-prefixed types are not private exclusions. Utility evidence does not establish full model coverage. |
| Drift | This record restores the audit's missing list-plan target. Existing live numbering read tests in `numbering-model-workflow.test.ts` supersede blanket live-owner-pending wording only for their tested subset. `NumberingPart.new` and absent-numbering creation remain explicitly unsupported. Historical inventory and documentation-error decisions are retained. |

## Validation

- Red: focused list suite had 5 failures and 27 passes before source changes.
- Green: `npx vitest run packages/docx/src/lists.test.ts`: 32 passed.
- Maintained DOCX workspace build closure passed; package lint/typechecks passed with one existing warning in `operation-types.test.ts`.
- `npm test --workspace=docx`: 245 files and 5,088 tests passed.
- Existing original regressions cover collisions, nested paragraphs, grouped
  restarts, mixed styles, style relationships and picture-resource preservation.
- No visual CLI behavior changed; no renderer/native-reference QA claimed.
- Commit owned files on main only; no push/release; later tasks remain pending.

## Acceptance verification continuation

Review reproduced one additional opaque-graph defect: `abstractNumId` references
with unknown attributes or nested elements were interpreted as ordinary IDs,
and restart materialization discarded their content. Two original memfs cases
failed before the correction (32 existing passes). Affected references now use
the existing scalar validator before resolution. Both list continuation and
restart reject these references as `unsupported-edit`; unrelated edits preserve
their exact numbering bytes and paragraph bindings. The focused suite passed
all 34 tests after correction.

The maintained DOCX build closure and package lint/source/test typechecks passed;
lint retained one warning in untouched `operation-types.test.ts`. Historical
live-numbering red/green logs were inspected separately and establish only their
recorded read/owner subset. The prior utility five-failure cycle is recorded
above; no separate raw utility log was located. Existing utility tests exercise
CLI/SDK serialized-byte parity and schema support. No visual CLI behavior changed,
and renderer, downloaded-corpus and native-reference QA were not run.

The root unit runner rejects `--workspace=docx`; scoped verification uses the
declared `npm test --workspace=docx` route. The first workspace run loaded the
intentional red cases and was stopped; it is not passing evidence. The fresh
post-correction workspace run passed 245 files and 5,090 tests (233.34 seconds).
`/out` is unavailable
on this host (read-only filesystem), so no temporary evidence files were created.
Whole-public-API and later level-definition/construction tasks remain pending.
