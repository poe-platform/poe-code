# DOCX cached fields

Scope: this bounded task only, on main. Local owned commit; no push or release.
Field creation, TOCs/captions and later tasks remain pending. The unrelated
pipeline-plan edit is excluded. No downloads, reference runtime, product network
access, host filesystem access, README additions or new dependencies.

## Implemented behavior

`inspectDocumentFields(bytes, options, context)` and
`editDocumentFields(bytes, {operation: "fields.set", options, input?}, context)`
back `fields list` and `fields set` in the existing optional command engine.
Product logic remains in packages/docx; existing safe-bash and root wiring are
unchanged. The shared text-markup helper is reused for tabs and line breaks.

The story-local stack parses simple fields and complex begin/separate/end fields
across runs, including nested instruction fields and nested result fields.
Listing emits form, instruction keyword (`kind`), exact decoded instruction
text, cached result, update/lock metadata, child field locations and revision-bound
owner locations. Split instruction nodes concatenate without trimming or adding
separators. Nested instruction values do not leak into the enclosing instruction;
nested displayed results contribute only to enclosing displayed results.
Effective compatibility branches are inventoried; inactive branches are retained.

Set supports existing MERGEFIELD, PAGE, NUMPAGES, REF, PAGEREF, SEQ and TOC cached
plain results, including empty caches. It writes to the first cached text leaf
and clears subsequent cached leaves, retaining all runs and their properties.
Empty complex caches insert after the separator inside the existing run.
Tabs and line breaks use run elements; leading/trailing spaces get xml:space.
Existing instructions retain exact source bytes, including whitespace, quote and
entity spelling. Flags retain their original spelling unless `update` explicitly
changes w:dirty. Lock metadata is reported and preserved, with no new lock setter.
No instruction, hyperlink, external resource or macro is executed or fetched.

An inner nested field can be selected independently. Replacing an outer result
containing fields rejects instead of deleting the inner structure. Instruction
nesting is retained during outer cached-result edits. Unsupported kinds, malformed
boundaries/metadata/quoted instructions, missing literal reference/merge operands,
opaque/tracked/controlled content, multi-paragraph cached structures and shared
story mutations reject. Complex fields without a separator are inventory-only.
Structural tab/line conversion rejects cached text containing embedded comments
or processing instructions; ordinary text/whitespace assignment preserves them.
The existing package validator may reject malformed packages before field parsing.
Every selected field is preflighted before XML staging; publication remains atomic
under the established capability contract. No-op and dry-run behavior, limits,
selection errors and binary stdout use the existing engine.

## Exact JS/security mappings and documentation reconciliation

Read docs/specs/docx.md, office-cli.md, office-sdk.md, root AGENTS.md and the
upstream-api-audit.md and upstream-api-inventory.json research register. There is
no field-specific public object entry in the pinned 920-object inventory. F22 is
an additive utility obligation, not grounds to invent or promote a live Field
class. The historical inventory stays unchanged.

| Surface | Exact mapping/disposition |
| --- | --- |
| Input/output | Owned Uint8Array and always-async Promise<FieldListData>/Promise<FieldEditData>; injected publication capabilities, limits and cancellation. No ambient time, filesystem, networking or callbacks derived from document data. |
| Selection | One-based field ordinals scoped by story/paragraph/table/cell, or revision-bound tokens; header/footer scopes explicit. Child lists are readonly JS arrays with ordinary zero-based indexing, length and iteration, not live model collections. |
| Instruction/result | Primitive strings, no coercion; instruction is decoded exact stored instruction text, while XML instruction spelling is retained byte-for-byte on edit. Kind is the uppercase instruction keyword, including unsupported keywords on read. Result is an explicit cached value, never recalculation. |
| Metadata | update maps to w:dirty; locked reads w:fldLock. Missing flags read false; 0/false/off and 1/true/on map to booleans. Omission retains XML. Explicit update false clears a true flag without altering lock or instructions. |
| Errors | Existing typed usage errors/exit 2; invalid package, unsupported edit and stale/missing/ambiguous selection/exit 1; publication/exit 3; limit-exceeded/exit 4; cancellation/exit 130. Prepublication failures publish no package bytes. |
| Grammar/schema drift | Narrow fields.list/set selectors to implemented owners plus field, removing inapplicable run/image/link/bookmark/control/revision/shape arguments from direct, SDK and batch declarations and help. Add only fields.list/read and fields.set/edit discovery plus bounded F22 capability. fields.add and field batches remain unimplemented. |
| Resource result | The full proposed ResourceDetails field union remains future model/resource work. This bounded utility exposes FieldListData explicitly; its kind is the instruction keyword, its form distinguishes simple/complex, and nested contains child locations. Do not silently conflate it with the proposed resource discriminator. |
| Complete public API | Retain all neutral method/property names, inherited part/element obligations, public underscore-prefixed types, helpers, enum aliases and collection/protocol rows. Paragraph/Run text setters, _Header/_Footer owners and live field/model APIs remain separately pending; no row is marked private or implemented by these utility tests. |

The implementation and test data are original. No reference-project identities,
assets or copied implementation enter product code/tests/output; no new legal
notice is required. Existing legal notices and historical evidence are preserved.

## Test-first evidence and QA procedure

1. `/tmp/docx-fields-red.log`: 11 initial regressions failed before implementation
   (missing field exports). `/tmp/docx-fields-cli-red.log`: eight CLI/discovery/
   selector cases failed before their implementation; one already rejected selector
   was retained as passing boundary coverage.
2. Review regressions preceded each fix: `/tmp/docx-fields-review-red.log` captured
   whitespace, empty-cache and unsupported-content defects;
   `/tmp/docx-fields-final-boundaries-red.log` captured foreign namespace, empty
   complex cache and line/tab markup defects; `/tmp/docx-fields-roundtrip-red.log`
   captured generated-result re-edit and help/schema drift;
   `/tmp/docx-fields-preservation-red.log` captured malformed metadata/instruction
   acceptance and comment loss during whitespace replacement.
   Final diff review added `/tmp/docx-fields-location-red.log` (two failing cases)
   and `/tmp/docx-fields-types-red.log` (two failing type assertions): refresh
   displayed run positions after insertion, reject structural conversion that
   discards embedded content, and remove the final stray typed bookmark selector.
3. Corrected newly authored oracle mistakes without changing original tests:
   complex delimiter and dangling-note fixtures fail in package admission with
   invalid-package; resource budgets use limit-exceeded; detecting italic markup
   must match `<w:i/>`, not the `w:i` substring of `w:instr`.
4. Original regressions use memfs only and independent raw XML/element assertions,
   not only round trips through the same field reader. Cover merge fields, both
   dialects, headers/footers, nested REF/PAGE, exact instructions, run properties,
   flags, controls, empty/no-op caches, stale/shared selections, limits, cancellation,
   unsupported structures and CLI list/dry-run/binary publication. Existing tests
   remain; discovery's exact inventories receive only the additive paths/F22 entry.
5. Manual QA: execute the actual command engine for field-set help, listing,
   successful dry-run and an unsupported instruction edit; render terminal output
   through the maintained terminal-png renderer and inspect the image. The optional
   docx command is not a root poe-code route; do not invent a root route for QA.
6. Run maintained DOCX tests and lint, the selected DOCX workspace build closure,
   portable exports and existing safe-bash DOCX tests. Commit explicit owned files
   only after checks pass, including this plan; retain disposable logs/images in
   /tmp and do not push.

## Verification

Verified locally on 2026-09-14:

- `npm test --workspace=docx`: 69 files, 1,772 tests passed, including 42 new
  field/CLI cases. Final runtime changes are in `/tmp/docx-fields-final2-test.log`.
  The subsequent non-null type assertion changes no runtime behavior.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript passed;
  `/tmp/docx-fields-final3-lint.log`. The initial position-refresh implementation
  exposed exact-optional-property typing in lint/build; the corrected assertion
  binds the known field ordinal and both maintained checks pass.
- `npm run build:workspaces -- --workspace=docx`: all five workspaces in the
  declared dependency closure and native postbuild checks passed;
  `/tmp/docx-fields-final3-build.log`.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  41 existing tests passed, none skipped; `/tmp/docx-fields-final3-shell.log`.
- `npx vitest run scripts/docx-exports.test.ts`: both portable dependency/export
  checks passed; `/tmp/docx-fields-final3-exports.log`.
- Additional actual Shell QA used an injected MemoryFileSystem and original
  in-memory field data: list JSON, selected-result dry-run and binary publication
  passed; raw reopened XML retained exact instruction/lock bytes and source bytes
  remained unchanged. No product host I/O or network capability was added.
- Inspected `/tmp/docx-fields-help.png` and `/tmp/docx-fields-workflow.png`, rendered
  from actual engine output. Applicable options, full instructions/results and
  exit 0/1 diagnostics are visible without clipping. No screenshots are unit tests
  or committed fixtures. The screenshots predate only the final type/location and
  embedded-comment guards, which do not change the displayed QA examples.
- `git diff --check` passed. Original tests, historical evidence, ignored fixtures,
  unrelated work and the existing index are preserved. No README changes.

This is scoped local validation, not full-root, native office rendering,
whole-public-API conformance, remote-main delivery or release evidence. Later
tasks remain pending. Only the owned task files are included in the local commit.
