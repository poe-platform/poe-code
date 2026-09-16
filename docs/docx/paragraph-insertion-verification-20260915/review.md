# Text/style/document verification: paragraph insertion correction

Whole-task acceptance remains open. This review verifies an atomic correction
within `adapt-upstream-text-style-document`; it does not certify every residual
document/paragraph/run/font/style/section/story/link/break/comment/settings case.
Root AGENTS.md applies; no extra instructions exist in docx or office-package.
Initial main was `7d94f691baed0cc9dbae4b98ec0bb1418db9ee25`; the index was empty.
Unrelated equation, discovery, pipeline and QA work is preserved.

Read the DOCX/shared office contracts, required test/API audits and inventories,
crosslinked counterpart audits, public register and scoped formatting/live model
overlays. Parsed inventories reconcile 1,609 unique unit identities, 650 BDD
examples and 920 unique API records. Those are historical research denominators,
not target passes. Inherited, enum/helper/collection, untested public and public
underscore-prefixed obligations remain visible. Exact mappings and five source
insertion identities are retained in [receipt.json](receipt.json).

The existing insertion method wrote names as IDs, did not accept typed style
owners, created empty runs, accepted unknown styles and raised a generic error
for nonstring text. Original small memfs tests failed seven times before code;
see [insertion-red.log](insertion-red.log). Two further original rollback failures
showed that style validation could leave a lazily created styles part behind;
see [rollback-red.log](rollback-red.log). The correction uses the existing owned
style resolver and transaction, with the public nullable-text/typed-style
signature already promised by the register. It adds no parallel editor.

Four original null/nonempty text and null/named-style combinations preserve
exact XML order, ID 42, run cardinality, default/named style and live receiver
identity. Original Unicode/tab/newline, differing name/ID, typed owner, invalid
input and foreign/wrong-kind style tests supplement these. Private helper/mock
call counts map to observable XML, content and owner behavior. The declared
typed batch invokes the same SDK method; memfs save/reopen confirms styles and
text survive publication. Model spelling remains neutral snake_case, operation
options retain their existing shared spelling, and no aliases are introduced.

The final focused run passed 25 tests in three files, 2.33 seconds;
see [focused-green.log](focused-green.log). Two assertion-authoring mistakes
were corrected without product changes: self-contained element serialization
includes ancestor namespace declarations, and text uses xml:space="preserve".
Those intermediate failures are not additional product defects or TDD evidence.

Prior evidence inspected: the embedded exact run-break red/batch-red transcripts
and final results in run-break-adaptation.json, formatting verification and
table/section/review verification. These scopes and counts are kept separate.
Some older raw logs were not retained, and the pinned temporary checkout is now
absent; no historical raw execution was freshly certified or reference runtime
rerun. Shared OPC/XML/image audits remain semantic inputs, not security or
cross-format parity proof. The product source/tests scan found no reference
project names/links; legal standalone notices are untouched.

Maintained checks and gaps:

- Baseline `npm test --workspace=docx`: 202 files, 4,005 passed, four skipped,
  142.86 seconds. This run completed before the new test file was included.
- Final `npm test --workspace=docx`: 203 files, 4,019 passed, four existing
  cross-format CLI skips, 143.68 seconds; all 14 new insertion tests executed.
  See [unit-green.log](unit-green.log). The four unexecuted cases are PPTX
  validate and DOCX tables list, unscoped diff and public-engine cancellation.
- Selected `npm run build:workspaces -- --workspace=docx`: exit 0, all five
  declared dependency build tasks; no fixed substitute closure or cache used.
- Final `npm run lint --workspace=docx`: exit 0, ESLint and both TypeScript
  checks. One unchanged type-only unused-variable warning remains at
  operation-types.test.ts:20.
- `npm run test:schemas --workspace=docx`: setup failed because
  DOCX_SCHEMA_ROOT is absent. All ten cases are unexecuted, not passes;
  [schemas.log](schemas.log). No schema download or native Office runtime followed.

No CLI help/layout changed, so no new screenshot campaign was run for this
correction. No document rendering, publisher corpus, network/host deployment or
independent schema success is claimed. No downloaded or cloned binary fixture
was acquired, shipped or deleted. All original tests use authored XML and memfs.

Current code still lacks Document.add_heading/add_page_break/add_section/settings
and Run.iter_inner_content; exact all-case adaptation and whole-public-API
acceptance remain incomplete. Earlier chronological pending labels are not
used as proof that later bounded implementations are absent. Historical registers
are not globally promoted by unit or discovery passes. The pipeline file has
unrelated user edits and is deliberately not staged or marked complete.

Only this atomic method correction, its tests and explicitly named plan/evidence
are owned for local Conventional Commit delivery. No README edits, push,
release, hook bypass, coauthor, ignored fixtures or broad staging.
