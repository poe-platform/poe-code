# Table and expanded workflow verification

Task: `adapt-upstream-tables-bdd` only. Inspected implementation at
`3c488165f14bac5314619c9c34b1731f47c33bd1` on main. Read root/scoped
instructions, DOCX and shared office contracts, both test audits and DOCX API
audit/inventory. No new product defect was reproduced; no product code,
canonical test, README or unrelated work changed.

## Acceptance accounting and provenance

Exact identities reconcile all 220 selected table units and all 650 expanded
BDD rows. All 870 evidence test paths exist; no selected row has a remaining
obligation. Dispositions retain 214 original table adaptations, five directional
helper language mappings, one tested nested destructive-text security rejection
and 650 original SDK workflows. They do not claim identical native execution.

All 534 independent workflow JSON pointers match their exact passed titles.
Workflow-owned source/test hashes, style test hash, table final-green log hash
and all nine delivery gate-log hashes match. Five historical input hashes match
current bytes; the public-map hash matches committed `bfc1adc98` bytes. The later
acceptance-reviewed `e79ce0251` map retains all 1,337 IDs/order and every selected
API pointer. The receipt now labels that historical snapshot and records the
current hash separately. The independently owned map and whole-API blockers
remain unchanged.

Inspected original assertions for omitted/empty slots, grid-before/after,
horizontal/vertical aliases, physical extents, L/T/partial-overlap rejection,
row/column bounds, collections, nullable widths/properties, rich content order,
terminal paragraphs, nested content and atomic failure preservation. Public
underscore and inherited owners remain accounted for. Actual SDK-backed Shell
tests exercise virtual scripts/substitution, binary pipes/stdin, Unicode,
save/reopen, merges, dry-run and preserved destinations. Logic remains in its
package; closed CLI actions use the SDK.

Inspected retained table content-width red (five failures/172 passes) and final
green (213 passes), batch-boundary red (two failures/one pass), document red
(four failures), style initial run (two failures/114 passes), and filtered
workflow red/final-qualified green outputs. Fixture-authoring and superseded
results remain historical. `exact-trigger-red.log` contains three passes/531
filtered skips: it does not independently prove a red phase. No red evidence
was reconstructed; no new code correction required a regression.

## Fresh checks

All routes exited 0; adjacent logs retain actual outputs:

- `npm test --workspace=docx`: [unit.log](unit.log), 216 files/4,905 passes,
  four cross-format skips, 166.52 seconds. All 199 table variants, 534 workflows
  and 116 style/tab workflows pass without skips.
- `npm run lint --workspace=docx`: [lint.log](lint.log), ESLint and both
  TypeScript checks pass, with one operation-types.test.ts warning.
- `npm run build:workspaces -- --workspace=docx`: [build.log](build.log),
  five declared builds and native postbuild checks pass.
- `node --import tsx --test` for table-model.test.ts, inline-picture-model.test.ts
  and docx-registration.test.ts: [shell.log](shell.log), 25 passes/no skips.
- Same Node route for tables.test.ts: [table-utility-shell.log](table-utility-shell.log),
  15 passes/no skips, including active-grid omission/span combinations.
- `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`:
  [registration.log](registration.log), 109 passes/no skips.
- `npm run test:runner --workspace=virtual-bash`: [runner.log](runner.log),
  522 passes/no skips.
- Write-spec checker passes with zero warnings after placing unchanged Purpose
  metadata beside Status/Implemented Through. Owned `git diff --check` passes.

The spec now links this verified milestone instead of calling live table owners
pending. Its full proposed contract and Implemented Through metadata remain
unchanged; whole-format conformance is not promoted.

## QA limits and delivery

Visually inspected retained terminal-inspected.png: readable picture EMU values,
dry-run output and invalid merge exit-1/affected-zero diagnostic. This is retained
terminal transcript evidence, not a fresh screenshot or office render.
Renderer QA remains **not run** under docs/plans/docx-table-bdd-adaptation.md;
the recorded unavailable renderer/denied Pages execution was not retried.
Pagination, wrapping, repeated headers and glyph fidelity remain unproved.

Root ESLint and safe-bash typecheck receipts were hash-verified and outputs
inspected, not freshly run. No full repository/full safe-bash unit gate, native
baseline, corpus, packed-consumer or whole-public-API qualification is claimed.
Four cross-format skips remain visible. Historical native artifacts marked
absent in the audits remain unavailable. The research clone is already recorded
removed after original reduction; this review downloaded, deleted and committed
no binary fixtures. Existing standalone legal notices remain retained.

Only task-owned documentation/evidence is committed locally; unrelated paths and
the initially empty index are preserved. Commit hash is reported in chat. No
push, remote-main delivery or release was attempted.
