# DOCX TOC, caption and reference structures

Scope: only the bounded field-structure task, on main, one owned local commit.
No push/release. Preserve the independently modified pipeline plan and all
historical evidence. Later tasks and whole-document live model coverage stay pending.

## Behavior and ownership

Product logic is in packages/docx. The existing command engine calls the same
`editDocumentFields` SDK for fields.add/set, toc.add/set and captions.add/set.
No safe-bash or root logic is added. Original tests are retained; exact discovery
inventories gain only the newly implemented paths and F23 capability.

Insertion appends to one explicitly selected whole paragraph, including explicit
story/table-cell scopes. It creates simple fields with separate instruction and
cached result XML. Existing complex and nested fields remain supported on read
and selected edit. Inserting inside a complex field spanning paragraphs rejects,
including an empty middle paragraph. Shared/controlled/tracked story edits reject.
No document-derived instruction, external target, host I/O or network executes.

fields.add accepts PAGE, NUMPAGES, REF, PAGEREF, SEQ and TOC. REF/PAGEREF/SEQ
require a target; the other kinds prohibit it. Literal operands are quoted and
reject quotes, backslashes and control characters. References may remain
unresolved. Empty result and update false are the field defaults. New TOCs
default to levels 1–3, empty title/result and update true. Captions append the
static label, SEQ cache and descriptive text; their sequence defaults to label,
result to empty and update to true. Default sequence collisions across admitted
stories reject, including split/quoted complex instructions. Explicit sequence
authorizes reuse; counters are never evaluated or incremented. static true emits
only label and text and rejects sequence/result/update options.

fields.set retains cached-result editing and adds typed kind/target/levels.
Explicit kind replaces the complete instruction definition and requires its
target where applicable. Target-only and levels-only changes preserve other
instruction switches and whitespace. Split instruction runs and result runs
remain distinct. Nested instruction replacement rejects. toc.set accepts levels,
text and update; captions.set accepts text and update. Their text explicitly
replaces the selected TOC/SEQ cache, not surrounding static labels or prose.
Static labels use the existing scoped text replace/paragraph operations for edits.
Outer nested-result replacement rejects. Metadata/instruction-only TOC edits can
preserve complex, multi-paragraph or nested cached contents without flattening them.
Only explicit update changes dirty metadata; omitted flags and locks are retained.
No cached pages, sequence numbers or TOC entries are computed by a layout engine.

Referenced bookmark creation/rename uses existing bookmarks.add/set with typed
range/name/reference policy. Original end-to-end regressions create a range,
create REF/PAGEREF fields, rename the bookmark and check that only operands change;
stored labels/pages/dirty flags remain unchanged. No separate bookmark model is
invented and no unrelated bookmarks are implicitly allocated.

## Exact JS/security mapping and documentation drift

Reviewed root/scoped instructions, docs/specs/docx.md, office-cli.md,
office-sdk.md and the audit/inventory under docs/docx. The pinned schema-v2
920-object inventory has no field/caption/bookmark/TOC-specific public model
entry. F22/F23 are additive utility obligations. Historical inventories remain
unchanged; no model row is promoted by these tests.

| Contract | Exact mapping |
| --- | --- |
| Entry point | `editDocumentFields(Uint8Array, FieldEditRequest, PublicationContext): Promise<FieldEditData>`; discriminated operation-specific readonly options. Input identity/publication remain injected capabilities. |
| Values | DocxFieldKind string union; DocxFieldLevels `{start:number,end:number}`, integers 1–9 with start ≤ end; plain strings and booleans, no coercion. Omission retains stored values; null is rejected. |
| CLI | Plural fields/captions plus the original toc resource; direct flags, common scopes/selectors/publication/JSON/errors. CLI levels N-M map to the same typed range. Boolean effect flags take explicit true/false. |
| Selection/result | One-based utility ordinals or fingerprinted tokens. Readonly result arrays use zero-based JS indexing/length/iteration; they are not live model collections. Insert/replace changes carry owner locations. |
| Instruction/caches | Typed operand edits never evaluate instructions. Exact unrelated XML is preserved. update maps to w:dirty; locked remains the w:fldLock read-only observation. Explicit kind means full instruction replacement. |
| Error behavior | Existing usage/2, unsupported or selection/1, publication/3, limits/4 and cancellation/130. No package publication before semantic checks and output-budget admission. |
| Public API coverage | Neutral model spellings, inherited members, public underscore-prefixed owners, enums/aliases, helpers and collection protocols remain tracked and pending according to their existing audit rows. No privacy reclassification or whole-API claim. |
| Drift resolution | The earlier cached-field milestone is historical. Current spec/audit links record creation and F23 support; help/schema narrow selectors and document new options. Batch argument types exclude outer publication fields; field batch execution remains pending and is not advertised as implemented. |

No downloaded corpus, native reference build, external assets or derived product
material was used. All behavioral fixtures and wording are original and use memfs
for mutation. Existing standalone legal notices remain unchanged.

## Test-first evidence and manual QA

- `/tmp/docx-structures-red.log`: five failing creation/TOC/caption tests before
  implementation, with the original fields.set-only rejection.
- `/tmp/docx-structures-cli-red.log`: discovery support failed before wiring its
  metadata; one new test also omitted the required boolean value, corrected to
  the existing explicit boolean contract without changing product parsing.
- `/tmp/docx-structures-boundaries-red.log`: quoted sequence collision and empty
  middle-paragraph insertion failures preceded their fixes.
- `/tmp/docx-structures-instruction-red.log`: lost unselected TOC switches before
  operand-preserving instruction edits.
- `/tmp/docx-structures-types-red.log`: two failing compile-time checks before
  excluding publication fields from field batch argument types.
- Run maintained DOCX tests/lint/build closure, portable export checks and existing
  safe-bash DOCX integration tests. Preserve original tests and historical logs.
- Manual QA: invoke the actual optional command engine with original memfs input;
  exercise help, TOC add, caption add/static, field list and TOC set dry-run. Render
  its real output through terminal-png and inspect the screenshots. The optional
  docx utility is not a root poe-code command; no root route is invented for QA.

## Verification

Verified locally on 2026-09-14:

- `npm test --workspace=docx`: 70 files, 1,785 tests passed, including 13 new
  original runtime cases. `/tmp/docx-structures-final-tests.log`. The subsequent
  batch type correction changes no runtime behavior.
- Final schema review added a failing insert-kind result assertion in
  `/tmp/docx-structures-result-red.log`, then corrected the new operations'
  mutation result schemas. `npx vitest run packages/docx/src/fields-command.test.ts
  packages/docx/src/discovery.test.ts scripts/docx-exports.test.ts`: 24 passed,
  `/tmp/docx-structures-verified-discovery.log`.
- `npm run lint --workspace=docx`: ESLint plus source/test TypeScript passed,
  `/tmp/docx-structures-verified-lint.log`.
- `npm run build:workspaces -- --workspace=docx`: five declared dependency-closure
  builds and native postbuild checks passed, `/tmp/docx-structures-verified-build.log`.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  41 existing tests passed, none skipped, `/tmp/docx-structures-shell.log`.
- Inspected `/tmp/docx-structures-help.png` and
  `/tmp/docx-structures-workflow.png`. Actual optional command-engine help,
  TOC/caption/static insertion, field listing and selected TOC dry-run all succeeded.
  Binary output stayed pure and was reopened from memfs. Terminal content is
  visible without clipping; the screenshot capture wraps at 110 columns.
- `git diff --check` passed. No README, unrelated pipeline-plan, downloaded
  fixture, legal-notice, safe-bash source or root implementation changes are owned.

This is bounded utility evidence, not native rendering, full-root checks,
whole-model conformance, remote-main delivery or a release. Later tasks stay pending.
