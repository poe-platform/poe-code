# International text and field verification

## Ownership and procedure

The root integration owner coordinates two implementation workers and a separate
case-accounting worker. International text owns text-run implementation and its
schema regions; fields owns field operations and integration. The root owns this
QA receipt, final review and explicit-file local commits on main. No pipeline,
push, release, README edit or downloaded fixture commit is authorized.

1. Require original failing tests for missing international run metadata and field
   operations. Assert actual DrawingML with an independent namespace-aware reader.
   Cover mixed scripts, combining marks, emoji, paragraph direction, vertical
   frame metadata, inherited fonts and unselected content preservation.
2. Admit cached fixtures only by exact path, size and SHA-256 from
   `docs/pptx/corpus-manifest.json`. Host reads are explicit QA setup; the product
   receives bytes and a memory filesystem. Do not fetch fonts, evaluate fields,
   download fixtures or use a native document runtime.
3. On the admitted small template, compare SDK and registered-shell field edits,
   inspect the literal cached value/type, and compare every untouched ZIP member.
   Preserve the cache input and keep all outputs in memory.
4. Exercise direct run metadata flags and field flags through actual safe-bash.
   Capture help and rejection output with the maintained `npm run screenshot`
   route and inspect the PNG. The separately injected virtual command is not
   exposed by `screenshot-poe-code`, so capture its actual Shell entry point.
5. Run maintained package lint/unit checks and selected workspace build, then the
   focused registered-shell pptx checks. Review exact source-case accounting and
   JS/security mappings without claiming broader public API completion.
6. Commit only explicitly named owned source/tests, relevant plans and usage/
   research receipts. Report local hashes separately from remote delivery.

## Admission evidence

Both cached inputs matched their manifest lengths and SHA-256 before inspection:

- `IXPE-Presentation-Template.pptx`: 1,202,514 bytes,
  `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
  Slides 2–5 contain `slidenum` fields; presentation defaults contain `+mn-ea`
  and `+mn-cs` font references. There are 105 field/font/vertical metadata nodes
  across the archive under the inspection filter.
- `CERN-intro-2025-v2.pptx`: 28,011,433 bytes,
  `62ab3f5c42e7a967af1f4cfc07cede3909a88b6c75f8432231e83a6e8d17e134`.
  Inspection found slide-number fields and East Asian/complex-script theme
  references, including `+mn-ea`, `+mn-cs`, `+mj-ea`, and `+mj-cs`.
  This was inventory inspection only, not mutation or rendering evidence.

The first inspection attempt used an incorrect QA assumption (`reader.entries`);
the actual package reader exposes `names`. Correcting the inline QA invocation
required no product change and is not counted as a product regression.

## Verification results

- Public source SDK and actual registered Shell produced identical bytes for
  `fields set` on slide 2, shape `Slide Number Placeholder 5`, using explicit
  cache `第二 é 🐚`. Independent SAX assertions found `type="slidenum"` and the
  exact supplied Unicode cache. All 38 decoded package members were compared;
  only `/ppt/slides/slide2.xml` changed. Output was 1,202,558 bytes, SHA-256
  `0d8c0bc886281476ab59a1942863751911d3900dc00341b68a9248b0293cdee4`.
  Both the VFS input and admitted host cache remained unchanged.
- QA invocation corrections: SDK positions require an explicitly named
  coordinate system; package member order is deterministically serialized and
  need not equal original ZIP order. The corrected assertions compare the exact
  member-name set and every decoded member byte. Neither invocation correction
  required product changes or establishes a product regression.
- Inspected `/tmp/pptx-fields-help-initial.png`: help returned 0 and missing date
  timestamp returned 2 before input reads. The help used one excessively long
  line and mislabeled shape names as IDs; these concrete QA findings were sent
  to the command owner for readable grouped help and an original regression.

- The international run edit also produced identical SDK/registered-Shell bytes
  on slide 2 (`Date Placeholder 3`, paragraph/run 0). Supplied East Asian and
  complex-script typefaces, charset -78, pitch-family 34, PANOSE
  `020B0604020202020204`, alternate language and RTL matched independent SAX
  assertions. All extracted text remained equal. Only slide 2 changed among
  38 members; output was 1,202,623 bytes, SHA-256
  `8888a76f7f28f0ba931140752229ad1f29c76388e5fc595c33fef7f4c1ea3b3a`.
- Inspected `/tmp/pptx-international-help.png` and
  `/tmp/pptx-fields-help-final.png`: complete grouped help, correct shape-name
  label, visible policy/publication flags and readable errors. Help returned 0;
  out-of-range charset and a missing date timestamp returned 2.
- Independent review reproduced a field inline-coordinate defect: paragraph
  property nodes shifted the field index relative to text extraction. Three
  original regressions now require semantic run/break/field indexing, exclude
  foreign-namespace lookalikes, and retain paragraph/end-run metadata.
- The first full integrated test run caught the intentionally red field result
  contract assertions (five failures, 1,887 passes). After the ResourceData/
  MutationData correction, the full package run passed 1,892 tests across 72
  files; lint and selected workspace build passed. The final field-coordinate
  correction passed its 35 focused tests; final integrated checks follow below.

Final verification passed:

- `npm test --workspace=pptx`: 72 files, 1,897 tests.
- `npm run lint --workspace=pptx`: ESLint and both TypeScript configurations.
- `npm run build:workspaces -- --workspace=pptx`: selected declared build closure.
- `node --import tsx --test --test-concurrency=1 --test-reporter=dot` with the
  explicit `packages/safe-bash/tests/commands/pptx/{create,selectors,inventory,fields}.test.ts`
  files: all passed against the rebuilt package.
- Focused ESLint on the new safe-bash field test passed.
- Both pinned inventory hashes matched; all 71 source pointers, 252 API
  identities/pointers and referenced original test files resolved.

These checks establish the documented bounded metadata/cache behavior and
terminal presentation. They do not establish rendered slide fidelity or complete
public model/API coverage. No binaries, README changes, push or release were made.
