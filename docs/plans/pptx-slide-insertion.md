# Slide insertion

Scope: insert one slide into an existing presentation with an explicit existing
layout and its validated master binding. Preserve layout defaults through
inheritance. Populate text placeholders by type/index; reject ambiguous requests.
No whole pipeline, README edits, host I/O, network, push or release.

Ownership: root owns slide SDK and its tests, spec reconciliation and this plan;
xml_edit owns parsed XML child editing and its tests; adapter owns command engine,
schema and focused command/Shell acceptance; case_audit owns insertion research
accounting. Root reviews and commits named files on main.

TDD: demonstrate missing SDK export and unsupported command, then test positions
1..length+1 including empty input, invalid positions, stable existing IDs/parts,
blank/custom layouts, sparse placeholder keys and ambiguous matches. Independent
ZIP/XML assertions reopen memfs bytes. Validate graph before and after mutation.

QA procedure: use an available manifest-listed disposable template, add one slide
with an explicitly selected layout, inspect output relationships and placeholders,
verify unchanged original parts. Reduce meaningful failures to original memfs
cases. Capture the command's human output for visual review. Do not commit binary
fixtures or screenshots. Run maintained pptx test/lint/build closure and the focused
safe-bash suite; record exact outcomes before local atomic commits.

Status: implementation in progress; baseline creation has no insertion SDK or
command. Full public model/API coverage remains a separate visible obligation.

## Verified implementation

The operation exports `addSlide` from pptx and exposes `slides add` through the
shared command engine. No root implementation or safe-bash adapter logic changed.
The safe-bash tests invoke the actual Shell with an injected memfs capability.
Text-capable placeholders inherit layout defaults; chart/table/picture placeholders
keep their types and reject text coercion. Existing layout/master bytes remain
unchanged. Blank layouts stay blank. Conditional presentation structure and signed,
macro-enabled or protected edits fail explicitly.

Independent review produced original regressions for missing nonvisual metadata,
duplicate placeholder nodes, duplicate inherited indices, wrapped protection and
missing master registration. Text admission and aggregate authored XML are bounded.
The standalone research notice retains the license for research evidence; product
code and test assets are original.

Maintained validation checkpoint:

- `npm test --workspace=pptx`: 22 files, 690 cases passed, including 40 insertion
  SDK cases and 16 insertion command cases. XML editing has 62 passing cases.
- `npm run lint --workspace=pptx`: source ESLint and both TypeScript checks passed.
- `npm run build:workspaces -- --workspace=pptx`: selected maintained dependency
  closure passed (office-package, toolcraft-schema and pptx).
- `node --import tsx --test packages/safe-bash/tests/commands/pptx/create.test.ts packages/safe-bash/tests/commands/pptx/selectors.test.ts packages/safe-bash/tests/commands/pptx/inventory.test.ts`:
  54 cases passed, including SDK/CLI parity at all insertion boundaries, in-place,
  dry-run, pipeline and failed-publication cases.
- Guarded root ESLint is being monitored separately for the safe-bash test edit.

## Disposable QA receipt

Manifest hashes were verified before reading the two available templates.
IXPE-Presentation-Template.pptx grew from 5 to 6 slides, using layout3; the
WWL-template-1slide.pptx grew from 1 to 2 slides, using layout1. Both inserted at
position 1 and passed post-edit semantic/index checks. For both, every existing
part retained exact uncompressed bytes except `[Content_Types].xml`,
`ppt/presentation.xml` and its relationship part. Exactly one slide and its
relationship part were added. This is structural preservation evidence, not
independent PowerPoint rendering or whole-format fidelity certification.

The generic maintained `npm run screenshot` runner captured actual pptx engine
help because this utility has no root poe-code command entry. The root reviewed
`.cache/pptx-corpus/qa-slide-insertion-help.png`: flags and syntax are readable,
complete and consistently aligned. The QA outputs have the owned prefix
`.cache/pptx-corpus/qa-slide-insertion-`; they are disposable and excluded from Git.
No downloaded bytes are used by unit tests or shipped by either package.

The byte operation is complete for this scope; broader live object-model methods,
inherited members, enums and unexposed operations remain explicit obligations in
research accounting. No whole pipeline, README edit, push or release was run.
