# DOCX model XML removal contract

Atomic correction within whole-api acceptance only; later tasks remain pending.
Root owns clean `packages/docx/src/model-store.ts`, new
`model-xml-removal-contract.test.ts` and this plan. No unrelated edits are owned.

## Agent QA procedure and red evidence

1. Original memfs test creates two small body paragraphs through the maintained
   original fixture. Select the first public model element and retain the second.
2. Before code, `view.remove()` throws StaleHandleError after committing deletion:
   XmlViewStore.change attempts to resolve its deleted binding root.
3. Bind the existing root-removal hook to the model's transactional domain edit.
   The view method then invalidates deleted views after successful removal,
   without querying their detached node. No host/runtime/network authority.
4. Check deleted paragraph/view handles fail as stale; retained content remains
   live and package save/reload contains only the retained paragraph. Exercise
   the existing bounded typed batch route through SDK/CLI in original workflows.
5. Run focused model/XML checks, maintained DOCX tests/lint and independent review.
   Commit only these owned files and relevant verified plan evidence on main.
   No README edits, ignored inputs, bypass, coauthors, push or release.

Independent review found that child-view removal also allowed deletion of the
required body, while the root hook allowed removal of a cell's terminal paragraph.
Two additional original tests failed before the semantic correction (expected
rejection, observed successful removal). Both binding paths now execute inside
the existing model transaction: semantic validation precedes committed node/view
invalidation, and failed validation restores owner handles and package state.
This is the same owned model binding, not a separate editor or new CLI grammar.

Verification: maintained DOCX suite passed 222 files / 4,961 cases; maintained
lint/TypeScript checks passed with one unchanged warning. Independent review
passed all three rollback/removal cases and paired SDK/CLI XML workflow.
Ad hoc CLI required-body removal returned exit 1 / invalid-package; inspected
`screenshots/cat-tmp-docx-whole-api-resumption-human.txt.png` for readable bounded
human rejection. Input and capture are disposable QA only, not committed.
