# Chart contract expansion

Authority: root/scoped AGENTS.md, `docs/specs/pptx.md`, `docs/specs/office-cli.md`
and `docs/specs/office-sdk.md`. No README edits, push, release, downloaded canonical
fixtures or reference-project identities in product code/tests/output.

## Scope and ownership

Expand the existing 19-type operation to all 29 writer-dispatched variants. Domain
owners implement package logic and original fast independent XML/memfs tests; the
integrating owner owns shared command schemas/help and final maintained checks.
The accounting owner owns this plan and `docs/pptx/chart-expansion-*` receipts only.
CLI routes remain SDK-backed. Existing unrelated changes remain untouched.

Research uses the pinned writer at commit
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be`, both upstream chart inventories and
crosslinked DOCX OPC/XML/image audits. The exact variant matrix and source-row
pointers are in `docs/pptx/chart-expansion-case-map.json`; all 1,407 broad chart
cases remain visible. The API map retains all 784 chart-related declarations.

## Implementation and validation procedure

1. Read existing insertion/replacement/cache/workbook behavior, then reproduce
   missing variants/data behavior using small original independent assertions.
   Keep expected XML literal and independent of production dispatch tables.
2. Implement area normal/stacked/percent-stacked, doughnut/exploded, radar/plain/
   filled/markers and bubble/plain/3D-decoration. Retain all earlier bar/column/
   line/pie/XY variants. Assert grouping, direction, marker suppression/defaults,
   radar style, explosion/hole size, smooth/line semantics and numeric axes.
3. Cover chart and series number formats, date-system boundaries, numeric and
   date category variants, consistent-depth multilevel labels and workbook/cache
   synchronization. Keep source multi-ring doughnut cases explicitly unsupported
   under the current one-series contract. Reject unsupported advanced/general-3D
   reconstruction without changing original package bytes.
4. Verify charts schema/capabilities/help advertise exactly the actual 29 variants
   and typed data options. Check common flags, owner-scoped selectors, version-1
   JSON envelope and shared exit statuses through SDK-backed commands.
5. Run focused new tests first to establish red/green evidence. Run maintained
   `npm test --workspace=pptx`, `npm run lint --workspace=pptx`, and
   `npm run build:workspaces -- --workspace=pptx`; use maintained scoped adapter
   checks for changed command integration. Record actual commands/results only.
6. Use the maintained screenshot route for changed terminal help/schema output;
   visually inspect it. If disposable external QA inputs expose meaningful cases,
   reduce them to original in-memory tests before deleting those inputs. Do not
   turn a binary corpus or temporary clone into unit-test dependencies.
7. Record exact evidence under `docs/pptx`, stage named owned files and this plan,
   and commit each atomic verified improvement on main with a Conventional Commit.
   Do not push or release.

## Completion limits

An operation expansion does not complete chart model builders, owner-bound object
identity, inherited graph members, arbitrary axes/point setters, all public enums,
helpers or collections. Public underscore-prefixed types remain obligations.
Unsupported advanced graphs retain explicit preserve/reject status. Existing
reference-suite pass counts never count as product passes.

## Execution receipt

Domain and workbook owners implemented the ten missing families/variants plus
hierarchy, formats and date-system synchronization after original failing tests.
The integrating owner added SDK-backed command, schema, capability, help and
bubble-decoration inspection regressions. Independent review found and reproduced
two imported-style problems; both were fixed with original memfs cases.

The maintained package gate passed 3,552 tests across 125 files. Following the
last two style cases/fix, the focused affected five-file gate passed 145 tests;
package lint and the maintained selected build passed again. Six actual shell
chart tests and built public SDK create/replace QA for all 29 variants passed
after that rebuild. Help screenshots were visually inspected. The specification
checker passed without warnings. Exact chronology and limitations are in
`docs/pptx/chart-expansion-evidence.md`.

The local atomic chart improvement includes only the explicitly owned chart
files, research/spec/usage updates and selected chart hunks in shared command
wiring. Preserve all existing image changes and other unrelated work. No push,
release, README change or disposable fixture delivery is authorized.
