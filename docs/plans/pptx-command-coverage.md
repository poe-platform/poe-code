# PPTX command coverage documentation and agent QA

Status: Documentation checks passed; all product acceptance below is proposed.

## Scope and ownership

Create `docs/pptx/command-coverage.json` and its evidence notes using root
`AGENTS.md`, the three shared/format specs, both upstream audits/inventories and
the existing public API map. No scoped `AGENTS.md` exists beneath `docs`.
Preserve all unrelated tracked and untracked changes, including the already
modified PPTX pipeline plan. This standalone plan is the owned plan update;
changing the existing pipeline's task statuses is outside this edit.

Only these three new files belong to this atomic documentation improvement:

- `docs/pptx/command-coverage.json`
- `docs/pptx/command-coverage-notes.md`
- `docs/plans/pptx-command-coverage.md`

Do not implement product code, edit a README, run a reference/native runtime,
fetch implicit network inputs, adopt downloaded/cloned binaries as tests, clean
up fixtures, push or release. Any future meaningful publisher-deck case must be
reduced into a small original memfs unit case before disposable-input cleanup.

## Documentation verification procedure

1. Parse the register and both API inventories. Compare exact ID sets: all 2,407
   source records and all 2,424 target rows must appear once; F01–F60 must each
   appear once. Check the 17 additive view members separately.
2. Resolve every feature/API/collection/behavior operation and test reference.
   Resolve every local schema reference and every external JSON pointer. Verify
   all pinned input hashes still match and both source-test inventory counts
   remain 2,700/973. Do not count source passes as target tests.
3. Review common simple flags, applicable selectors, cardinality, output
   publication, errors, diff statuses, discovery and closed typed batch schemas.
   Check method/getter/setter routes against the existing target map, including
   D07's promised setter, step-aware slices and D16–D18 corrections.
4. Check preservation-only subsets have no editing operation. Verify the 29
   chart-creation variants against the pinned static writer dispatch and source
   hash. Do not execute the source runtime.
5. Run the maintained scoped Prettier formatter/check on only the three owned
   files. Run `git diff --check`, inspect the staged path list and commit one
   atomic Conventional Commit locally on `main`. Do not push.

## Proposed product acceptance procedure

Execute these steps only after the product exists. Use original tiny presentations
in the configured in-memory VFS. These are agent instructions, not a QA script or
claims of executed tests. Convert failures into original narrow unit tests using
TDD before changing code. Inspect help/error screenshots when a CLI exists; do not
add screenshot unit tests.

1. Create `Coastal survey.pptx` with explicit size/output; inspect its slides and
   capabilities. Read text through `text` and `text get` and compare results.
2. Run `text replace` with `--find Draft --with Final --all`; repeat with first
   and occurrence. Verify only the requested scope changes and split-run Unicode,
   emoji/combining text and hyperlinks survive. Reject absent/conflicting modes.
3. List images by occurrence and with `--unique`. Replace `--slide 1 --image 1
--file emblem.png`; verify another occurrence sharing the original resource
   stays unchanged. Repeat with `--shared` and check reported effects. Extract
   original bytes and compare hashes and safe output names.
4. Use `tables set --slide 1 --table 1 --cell B2 --text 'Coastal survey'` and
   `properties set --name title --value 'Coastal survey'`. No JSON or XML IDs may
   be required. Check ambiguous labels and merged-cell conflicts fail atomically.
5. Compare a full shape/cell/paragraph text assignment with preserving replacement;
   verify their different formatting scope and required empty paragraphs.
6. Inspect a slide with no notes and verify unchanged bytes. Obtain the slide
   handle and call the declared `notesSlide.get` typed operation; verify its
   creating effect, returned handle and single publication. Repeat on existing
   notes, then cancel before publication and verify rollback.
7. Replace a rich placeholder through typed batch. Verify sparse key lookup,
   returned picture/graphic-frame type and deterministic old-handle invalidation.
8. Exercise category/date/XY/bubble data, chart axes/labels/series/points and each
   declared creation variant. Verify simple workbook/cache synchronization.
   Existing unsupported chart substructures must survive unrelated property edits;
   unlisted chart construction fails without a downgrade.
9. Exercise collection bounds, negative `.at` policy, sparse keys, iteration,
   equality, and supported `slice(start, end, step)`, including reverse traversal
   and zero-step rejection. Check original typed value/enum/helper cases even
   when no upstream test lead exists.
10. Exercise each bounded XML/part view through its fixed operation schema.
    Reject foreign owners, cycles, invalid XML/part identities, unknown fields,
    arbitrary member names, executable expressions and prototype keys. Assert no
    host/network/native access occurs.
11. Apply an unrelated core-property edit to every preservation-only feature
    package. Compare retained part bytes, namespace/MCE ordering and relationships;
    reopening alone is insufficient. No semantic editing route may be advertised.
12. Exercise stdin, spaces, Unicode, `--`, binary stdout, dry-run, in-place,
    force/input aliases, output-directory partial failure, cumulative budgets and
    cancellation. Verify destinations survive all prepublication failures.
13. Diff equal and different documents: statuses 0 and 1 respectively, both
    successful JSON; comparison trouble is 2 and cancellation 130. Ordinary
    commands use the separate 0/1/2/3/4/130 meanings.
14. Enumerate schema/help for every declared operation and value type; compare
    capabilities to actual supported subsets. Use screenshots to inspect help,
    common commands and errors. Record actual results separately from planned
    cases and do not mark coverage implemented without public entry-point tests.

## Check results

Passed documentation checks on 2026-09-13 UTC:

- Exact ID closure: F01–F60, all 2,407 source IDs and all 2,424 target rows,
  including 17 additive bounded-view members, each accounted for once.
- All operation/test references, local schema references and external JSON
  pointers resolved. Input audit/inventory/spec/API-map hashes matched. Recorded
  source test counts remain 2,700 unit variants and 973 BDD examples.
- Reviewed 1,933 operation declarations and 6,301 planned acceptance cases.
  All operations remain unimplemented and every case remains planned/unrun.
- Installed AJV 2020-12 validated every operation argument/result fragment's
  schema shape. All 1,021 discovery-argument and representative positive/negative
  schema checks passed, including D07's setter, step-aware slices, typed chart
  creation and rejection of arbitrary fields. These are document checks, not
  public CLI/SDK or product tests.
- Static chart dispatch inspection confirmed 29 creation variants and its pinned
  source hash. Preservation-only subsets have null editing routes.
- C02–C04 resolve newly verified command-field drift without rewriting the earlier
  API evidence: fake freeform close route, schema discovery arguments, cell
  coordinate recipes and PERCENT_40 XML expectations.
- Maintained scoped Prettier and whitespace checks passed for the owned files.

No product tests, reference suites, renderer runs or screenshot checks were
executed. No product code, README, publisher inputs or cloned binaries changed.
The local commit hash is reported from Git after commit; nothing is pushed or
released. Existing unrelated work remains outside the staged paths.
