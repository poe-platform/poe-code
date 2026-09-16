# Exact table unit variant adaptation

Task: `adapt-upstream-tables-bdd`; only this task is active. Later tasks stay pending.
Ownership: new `packages/docx/src/table-behavior-variants.test.ts`, new
`docs/docx/table-behavior-variants-20260915.json`, this plan, retained evidence
under `docs/docx/table-behavior-evidence-20260915`, and exclusive validated repairs
in `packages/docx/src/table-model.ts`. The coordinator owns maintained checks and
atomic Conventional Commits on main; no push, release, README edit or fixture commit.

## Source inspection and original tests

Read root instructions and the DOCX/shared office SDK/CLI contracts, both DOCX
inventories and audits, the counterpart PPTX test audit, existing table API and
case evidence. Independently inspected every exact variant from
`tests/test_table.py` and `tests/oxml/test_table.py` at pinned
`e45454602b53e8e572b179ccf1c91093ec9f4ed7` from
https://github.com/python-openxml/python-docx. Retrieved a disposable full checkout
at `/tmp/docx-table-source-20260915` because the earlier recorded checkout was
absent. Its binary documents are research inputs, never test dependencies.
The other worker shares this checkout for BDD inspection; delete after both
workers finish reducing meaningful cases to original in-memory regressions.

The new overlay contains one independent row for each of the exact 220 unit
variants, with meaningful bound parameters, required observations and original
passing case pointers. Test wording, labels and document text are original.
Tests use the maintained memfs fixture writer and real admitted ModelStore;
no Python runtime, document downloads, ambient filesystem, timers or LLM calls.
Private helper/mock mechanics map to explicit observable model/coordinate editor
behavior, with specific explanations on each affected row. Rich unsafe whole-cell
replacement remains an explicit tested security rejection, not destructive API
parity. Source-style incidental names become original live style definitions.

## Red-before-code repairs

1. `properties-red.log`: universal column measurements failed before length
   conversion repair. New original cases preserve centimeters, millimeters and
   points as exact EMU values, alongside raw integer and absent widths.
2. `geometry-red.log`: all seven invalid L/T endpoint requests succeeded before
   rectangle endpoint validation. Each now rejects with unchanged XML.
3. Null row-height/rule cases and the BDD worker's independent null-rule red
   identified empty remaining height elements. Remove an empty element when its
   last owned attribute clears; preserve the other attribute and inferred
   AT_LEAST when a height remains.
4. The original pct-to-dxa red and the BDD worker's existing-width red identified
   sequential attribute updates conflicting with the XML editor's single owned
   mutation guard. Replace the property subtree once, merging existing attributes
   and preserving existing content and namespace bindings.
5. `empty-rows-red.log`: empty table public collections threw package errors.
   Noncreating empty model collection reads now expose zero length and iteration;
   out-of-range positions remain BoundsError. Adding a row without declared
   columns still rejects before mutation.
6. `property-order-final-red.log`: a new row-property container preceded stored
   table-property exceptions. Insert it after tblPrEx, preserving sdt/del siblings.

Other red logs include explicitly corrected test-construction assumptions; they
are not product regression evidence. In particular copied-grid identities were
incorrectly compared across separate grid snapshots; corrected tests assert live
public owner identities. Empty paragraphs use authored empty nodes, while empty
runs remain meaningful content. Private explicit growth can cover a valid
coordinate rectangle even when public opposite-corner owner endpoints would
have an invalid L shape; both behaviors have separate passing cases.

## Verification

`final-green.log` records the new 199 original tests and existing 14 model tests
passing. The coordinator runs maintained workspace build/unit/lint and safe-bash
checks, records those separately, and commits explicitly owned paths.
Owned ESLint was run; package/test typechecks are also run and their final status
is reconciled by the coordinator because concurrent owned work is being completed.
These tests change package semantics, not CLI visual presentation.

## Renderer QA procedure and status

Status: **not run**. In-memory XML/model passes do not prove layout fidelity.
Renderer-only behavior requires this explicit Markdown procedure:

1. Create an original document with declared unequal column widths, row height
   defaults/exact/minimum rules, RTL/LTR tables, cell vertical alignment and styles.
2. Include horizontal, vertical and rectangular merged cells; blank paragraphs,
   empty runs, ordered rich blocks, nested tables and omitted leading/trailing
   row grid slots. Save/reopen through the SDK and inspect logical aliases.
3. Open in an available document renderer and capture every affected table/page.
   Check declared grid/width behavior, alignment, minimum/exact height and retained
   nested content; compare to the original authored document, not binary fixtures.
4. Attempt each invalid L/T merge and ensure no published output changes.
5. Store renderer name/version, screenshots and observed results in docs/docx;
   record unavailable renderer or unrun procedures honestly. Delete disposable QA
   documents after original in-memory regressions are retained.
