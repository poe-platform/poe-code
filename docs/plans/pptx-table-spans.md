# Table span editing and verification

## Ownership and scope

Root coordinates verification, package exports and local commits on main.
Domain owns span algorithms and live table model; adapter owns operation/schema
and registered command coverage; accounting owns exact research receipts and
independent original behavioral cases. Historical ownership receipts do not
supersede these assignments. No whole pipeline, push, release or README edits.

## Required behavior

Merge ordered rectangles only when every intersected existing span is wholly
contained. Combine origin paragraphs in row-major order; split retains that text
at the origin and releases empty cells. Validate physical rectangular grids and
all continuation metadata. Insertion requires expand/reject; deletion requires
shrink/reject. Transfer deleted origin content to the first surviving position.
Retain row/column sizes and update total extents; iteration includes every
physical grid position with explicit merge roles. Preserve unknown properties
and unrelated archive members. Live SDK indices are zero-based; command selectors
and structural positions are one-based. All policies are explicit stored values.

## Agent-executed QA procedure

1. Establish failing original in-memory tests before implementation. Compare
   explicit expected XML attributes, coordinates, text and dimensions rather than
   deriving expectations from the mutation implementation.
2. Reconcile the pinned test and API inventories, every relevant parameter and
   expanded scenario, including public range/collection behavior without tests.
3. Run the maintained pptx unit/lint and selected workspace build closure; run
   focused registered safe-bash tests and exact discovery validation. Do not
   execute the whole pipeline.
4. Admit an already cached table-bearing entry from corpus-manifest.json only
   after checking size and SHA-256. Use explicit bytes/memory capabilities for
   SDK and registered CLI, retain outputs in memory, compare intended XML and
   every untouched archive member. No downloads or shipped corpus fixtures.
5. Capture and inspect terminal help and an explicit span-conflict diagnostic.
   Treat that as terminal QA, not a claim of slide rendering fidelity.
6. Reduce meaningful findings to small original regressions. Commit explicit
   owned files and these receipts after maintained checks pass; report local
   hashes separately from remote delivery (not requested).

## Verification receipt

- `npm test --workspace=pptx`: 103 files, 2,945 tests passed in 32.64 seconds
  at the first complete implementation checkpoint. The new domain and independent
  span suites contributed 19 and 21 original cases respectively.
- `npm run lint --workspace=pptx`: passed (source lint and both source/test types).
- `npm run build:workspaces -- --workspace=pptx`: passed the maintained selected
  dependency closure. Final build follows the final admission guard.
- Registered Shell table tests: five passed. No adapter source changes or new
  test-discovery paths were necessary; existing literal registration was retained.
- `/tmp/pptx-table-spans-cli.png` captured through `npm run screenshot` was
  visually inspected: help, explicit policy distinctions and the invalid-policy
  diagnostic with exit status 2 are legible without clipping. This verifies
  terminal presentation only, not slide rendering.

The cached corpus entry `SEWP_Training_Slides_May 2026.pptx` was admitted at
8,141,046 bytes with SHA-256
`83a63c49e09d89f7804a6dcad64fb9d61bc3401dc10d3351cc5222821c85bcf7`.
Slide 12 contains a 2-by-3 table whose top row has a three-column origin and two
physical horizontal continuation cells. Initial split preserved all cell text
and changed only `/ppt/slides/slide12.xml`.

The public built byte SDK and actual registered Shell then merged the complete
2-by-3 range, inserted column 2 with expand, removed origin column 1 with shrink,
and split the surviving origin. At each operation, complete output archive bytes
were identical across SDK and CLI. Independent expectations verified origin text
concatenation, six unmerged physical positions after split, unchanged heights and
widths `[original second, original second, original third]`. All 129 members
remained present and the 128 unedited members were byte-identical. Final output
was 8,141,055 bytes, SHA-256
`ddd86f886b400cb4e8d08410fdb3f79e154c1fc128606fe3d287fd71608d557d`.
All outputs stayed in memory; no corpus bytes or generated binaries are staged.

Review findings were reduced to original regressions for stale coordinate/text
handles, bulk writes to continuation cells, identity-merge preservation, semantic
empty paragraphs/fields and deeply nested foreign extensions. No corpus-derived
product assets or reference identities were added.

Final verification after the last admission guard and seven boundary additions:
selected workspace build and package lint both passed. The focused domain,
independent-case and command suites passed 58/58 (26 + 21 + 11), and all five
registered Shell table tests passed against the rebuilt package. The boundary
additions required no product changes. Accounting validates all 42 relevant
merge/range/split identities; three placeholder insertion obligations remain
outside this change and are explicitly deferred. Contained existing spans are
accepted by the required contract and recorded as a deliberate behavioral
mapping rather than an identical reference-baseline result.

Targeted safe-bash test-file ESLint passed. The exact maintained discovery test
`default normal runner passes every discovered active file to serial Node execution`
passed and confirmed the unchanged literal table-test registration; it did not
execute the discovered suite.
