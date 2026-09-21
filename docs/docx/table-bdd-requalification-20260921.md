# Table and expanded workflow requalification

Task: `adapt-upstream-tables-bdd` only, on main at `50aa3d867` before this
documentation change. Owned paths are this evidence record and
`docs/plans/docx-table-bdd-adaptation.md`. The unrelated parent pipeline plan,
source edits and other work remain outside staging. No README, push or release.

The missing linked plan was reproduced by reading the specification and audits:
their `../plans/docx-table-bdd-adaptation.md` target did not exist. Restore its
original Markdown procedure from the parent of `314ba0299`, retaining historical
results and original failing-test evidence. Update the renderer availability
statement for the current environment. No new product defect was reproduced,
and no code or canonical test is changed; the code TDD requirement therefore
does not call for a fabricated regression or reconstructed red result.

Parsed inventory set comparison verifies exactly 220 selected table variants
and 650 expanded BDD identities against the 870-row verification register:
no duplicates, missing identities or orphan rows. Every row has an existing
original test path, explicit semantic disposition and no remaining selected-case
obligation. Dispositions are 214 original adaptations, five language mappings,
one tested security mapping and 650 original SDK workflows. All 534 retained
independent workflow report pointers resolve to their exact passed titles.
These are retained passing reports, not fresh execution of the reference suite.

Read DOCX/shared office specifications, root/scoped instructions, both test
audits and the DOCX API inventory/audit. The restored plan preserves exact
JS/security mappings, including async capability I/O, synchronous admitted
owners, neutral snake_case names, checked collections, typed values, owner
lifetime and explicit unsupported numbering construction. `table_direction`
remains the correct spelling; no `direction` alias is introduced. Public
underscore-prefixed/inherited members, enums, helpers and APIs lacking upstream
tests remain in the whole-public-API register. All 52 table API overlay pointers
still match exact identities in the current 1,337-row public register. Selected case completion does
not waive its unrelated blockers or establish whole-format conformance.

Fresh selected safe-bash checks:
`node --import tsx --test` on `docx/table-model.test.ts`, `docx/tables.test.ts`,
`docx/inline-picture-model.test.ts` and `docx-registration.test.ts` passed
40 tests with zero failures/skips. Coverage includes virtual script execution,
binary input, plural resources, SDK reopen, omitted grid slots/spans, rich
content, merge/split, dry-run and failed publication preservation.

Maintained package lint passes with zero errors and one existing unused-type
warning in `operation-types.test.ts`. The selected workspace build closure
passes all five declared builds and native postbuild checks. The maintained
safe-bash `test:runner` route passes 563 tests with zero failures/skips.

Fresh focused original SDK checks pass all 963 tests in seven files: table
behavior variants, merge variants, active grids, live table owners, typed
command boundaries, all 534 workflow variants and all 116 style/tab variants.
No skips. This independently reruns every expanded BDD target and the selected
table target families, without consuming external fixture documents.

The initial maintained package run, concurrent with build/lint/runner work,
finished with 5,188 passes and two 5-second timeouts: style workflow 039 and the
guide table-grid workflow. The isolated style case passed in 97 ms, and the
entire style file subsequently passed in the 963-test focused run. No assertion
or timeout was weakened. A fresh maintained package run follows after the
competing build/lint/runner jobs have completed; the initial run is not counted
as a passing package gate.

That fresh `npm test --workspace=docx` run passes **252 files / 5,190 tests**,
zero failures/skips, in 226.93 seconds. Both timed-out cases pass unchanged
(guide table-grid: 431 ms). The successful rerun qualifies the maintained
package gate; the initial timing failures remain visible above. Owned
`git diff --check` also passes. No full-repository test/lint gate is claimed.

Renderer QA: **not run**. `/opt/homebrew/bin/soffice` is now present; its presence
does not qualify pagination, repeated headers, wrapping or glyph fidelity.
The restored plan contains the explicit renderer procedure. Historical denied
Pages execution is a past campaign result, not a current permission request.
No CLI visuals changed and no new terminal screenshot is claimed.

No downloaded document or binary clone fixture was acquired, shipped, used as
a canonical test dependency or deleted. Original memfs tests and standalone
legal notices remain retained. Later tasks remain pending. Delivery is local
only; remote-main verification and release are not attempted.
