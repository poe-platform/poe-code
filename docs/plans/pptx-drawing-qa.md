# Drawing fill, line and effect verification

Status: bounded implementation verified; final execution receipt below.

## Ownership and scope

Root coordinates integration, independent review, disposable corpus QA and local
commits. Domain owner implements packages/pptx drawing codecs and live models;
command owner integrates shared operation schemas and safe-bash adapters; accounting
owner records exact original case and public API evidence. No root product logic,
README edits, downloads in unit tests, push, release or whole pipeline execution.

## Independent acceptance procedure

1. Run original failing unit tests before implementation. Assert literal XML values,
   child ordering and unchanged bytes using independent parsers/ZIP readers where
   appropriate; do not derive expected values from the formatter being tested.
2. Exercise missing fill versus no-fill, solid/gradient/picture/pattern fills,
   mixed color representations and retained theme references. Test finite limits,
   ordered endpoint stops, zero opacity/line width/blur and invalid updates.
3. Preserve effect DAGs, unknown effects, scenes and materials byte-for-byte on
   compatible edits; reject destructive unsupported effect replacements before
   publication. Use original in-memory fixtures for features absent from corpus.
4. Verify live SDK behavior and paired CLI operations, schemas/capabilities,
   selection, failure statuses and no-publication behavior.
5. Run maintained focused package checks and inspect help/error screenshots.
   Stage explicit owned files only and commit each atomic improvement on main.

## Disposable corpus procedure

Use only docs/pptx/corpus-manifest.json entries. Verify SHA-256 before admission.
Run explicit development-only reads of cached bytes; product code receives only
bytes/capabilities. Keep any derived QA output in ignored cache and never stage it.
Use a small template for all supported fills, ISOLDE-drawings for retained 3D theme
properties and actual slide shadows, and data-visualization-course for pattern
inventory and slide 3D payloads. Compare every unselected ZIP member and retained
advanced effect XML after edit/reopen. Reduce any meaningful issue into a small
original in-memory regression before accepting a fix. No permanent QA script.

## Corpus census evidence

All 14 existing manifest entries were present and matched their listed SHA-256
on this task's read-only census. XML was parsed independently with ElementTree.
All contain solid/picture fills and gradients. Seven contain scene3d/sp3d;
data-visualization-course contains two pattern fills in chart style parts.
No effectDag was present. These are input characterization facts, not runtime
preservation or rendering results. The absence of DAG examples requires original
regression evidence; pattern inventory does not establish chart editing support.

## Execution receipt

Initial maintained `npm run test:unit --workspace=pptx` ran while TDD cases were
being introduced: 91 files / 2,557 tests passed; two newly introduced CLI tests
failed. One established missing schema support; the other exposed an invalid
test preset spelling, corrected by the command owner. This is a red-stage
receipt, not completion. Subsequent final checks are recorded below.

### Real-world preservation receipt

Verified `data-visualization-course.pptx` SHA-256
`ce874bc9782258175b84f5e438123552b78c993e0add9015f35d8ca2dd5c45d2`.
Through byte SDK mutateDrawing, edited slide 2 shape ID 10 to a solid accent2
theme reference with 0.75 opacity. Independent ZIP inspection found exactly one
changed member, `ppt/slides/slide2.xml`; all other payloads remained identical.
Compared raw selected effectLst, scene3d and sp3d markup before/after: all three
were identical, retaining innerShdw, camera/lightRig and bevelT. Reopened SDK
inspection reported SCHEME/accent2/0.75 and affected=1. All QA output remained
in memory. This establishes structural preservation, not visual rendering.

### CLI and adapter verification receipt

The command worker implemented `shapes drawing get|set` and `shapes effects set`,
with direct fill flags, structured fill/line options, schema/capabilities, explicit
picture-file admission and common selection/publication protections. Original
command tests first failed on missing operations, then passed after implementation.
A schema-result regression exposed the old F22 effect tag and missing drawing
inspection metadata; F27 and the drawing result declaration now agree.

Verified commands:

- `npm run build:workspaces -- --workspace=pptx`: passed the declared dependency
  closure (office-package, toolcraft-schema, pptx).
- `npm run lint --workspace=pptx`: passed ESLint and both production/test TypeScript
  checks after the model owner fixed line-width getter typing.
- `npx vitest run packages/pptx/src/command-drawing.test.ts`: 10 original tests
  passed, including RGB/theme exclusivity, alpha/gradient/line bounds, picture
  byte and file admission, schema results and simple shadow publication.
- `node --import tsx --test packages/safe-bash/tests/commands/pptx/fields.test.ts`:
  four tests passed, including a real registered virtual-shell `.sh` script with
  quoted paths and subsequent SDK theme/alpha inspection.
- `npx eslint packages/pptx/src/command-engine.ts packages/pptx/src/command-schema.ts packages/pptx/src/drawing-schema.ts packages/pptx/src/drawing-operations.ts packages/pptx/src/command-drawing.test.ts packages/safe-bash/tests/commands/pptx/fields.test.ts`:
  passed.

A workspace safe-bash runner attempt with `SAFE_BASH_TEST_RG` did not honor that
filter and discovered the entire suite; the worker interrupted it rather than
claim a completed run. The focused Node test route above completed successfully.

Rendered actual `shapes drawing set --help` stdout through the repository
terminal-png renderer to disposable `/tmp/pptx-drawing-help.png` and visually
inspected it: readable, unclipped command paths, paint flags, selection scope,
publication controls and preservation limits. There is no root poe-code `pptx`
route, so `screenshot-poe-code` cannot exercise this command; this direct engine
capture is the applicable fallback. No screenshot test or QA script was added.

### Final maintained verification

- `npm run test:unit --workspace=pptx`: 96 files, 2,761 tests passed after the final missing-gradient-stop
  default-transform regression.
- `npm run lint --workspace=pptx`: passed source lint and source/test type checks.
- `npm run build:workspaces -- --workspace=pptx`: passed maintained selected
  workspace dependency closure, three builds.
- Parent independently inspected the actual help screenshot and the corpus
  preservation receipt above. Built public byte SDK smoke also passed creation, shape insertion, pattern
  mutation and reopening through package exports. No full pipeline, push or
  release was executed.

The requested shape drawing subset is implemented. Whole public SDK parity is
not claimed: the additive ledgers retain broader chart/table/background/font
owner APIs and unimplemented public members explicitly. PNG admission checks
chunk structure and CRC; JPEG admission checks frame/scan container structure.
Neither admission path decodes pixels or promises image-rendering validity.
Only the stated corpus shape was mutated; other census files are inventory
evidence, not completed mutation QA. No disposable binary was staged.
