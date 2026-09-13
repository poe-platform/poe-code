# Presentation settings implementation and QA

Scope: implement supported slide/notes dimensions, orientations, first slide number
and slideshow options through the original `pptx` byte SDK and configured CLI.
Default size edits change the canvas only. Explicit content scaling must handle
supported group geometry or reject unsupported transformations atomically.
Grid/view/print and vendor metadata survive edits outside their requested fields.
No README changes, native product runtime, ambient host I/O, product networking,
whole-pipeline execution, push or release. Work stays on main, preserving unrelated
changes. Starting parent: `c3c8d43926c2a77acbc05a7d7561a9ec0aeb473b`.

## Ownership and implementation

The integration owner coordinates shared registry/export/spec updates, checks,
QA and local commits. The settings worker owns package settings implementation
and original domain tests. The adapter worker owns package command schemas and
engine routes plus safe-bash adapters/tests. The research worker owns only this
plan, `docs/pptx/settings-case-accounting.json` and `settings-usage.md`.

1. Read root/scoped instructions, format/shared contracts, pinned test/API audits,
   their inventories, the target API map and corpus manifest.
2. Reproduce unsupported settings behavior with failing original TypeScript
   tests; use in-memory packages and memfs publication tests, independent XML
   assertions and explicit values. Keep each source parameter/example separate
   in the research receipt. No downloaded fixtures or test-time network.
3. Implement a single package domain path for SDK and CLI. Update generated
   schemas/capabilities and reject inapplicable flags. Keep source identities
   exclusively in research or required standalone notices.
4. Verify focused original tests, maintained package lint/TypeScript and selected
   workspace build closure. Verify the registered CLI routes in virtual Shell,
   publication protections and direct SDK behavior. Run screenshots for changed
   CLI help and representative read/error output; inspect the resulting images.
5. After checks pass, integration owner stages only explicitly owned files and
   related plan changes. Make atomic Conventional Commits on main and record
   local hashes separately. Do not push or release.

## Test obligations

- Missing/present width and height inspect without creating XML. Explicit width
  or height updates retain the other axis and produce independently verified XML.
- Canvas-only changes preserve every slide, notes, master, layout, relationship,
  print/grid/view and unrelated vendor part byte-for-byte where unedited.
- Orientation swaps an existing pair; reject conflicting explicit dimensions.
  Notes dimensions are independent from slide dimensions.
- Signed 32-bit slide numbering, true/false slideshow booleans, mutually exclusive
  show type children and option preservation. Missing show properties may be
  created only on explicit edit, with valid relationship/content-type metadata.
- Scale-content is explicit. Check nested group coordinate transforms, reject
  unsupported transforms before publication and independently assert expected
  coordinates; changing canvas alone never scales shape coordinates.
- CLI reads/mutations, schema/capabilities, common version-1 envelopes, strict
  unknown fields/options, dry-run, in-place, force/alias rules and failure status.
- Retain live `Presentation.slide_width`/`slide_height` and inherited/value APIs
  as pending when only the additive byte SDK is implemented. Full model coverage
  is not established by operation support.

## Disposable corpus QA procedure

Use `docs/pptx/corpus-manifest.json` as the sole fixture receipt. Verify cached
bytes against each manifest SHA-256 before use. Do not download missing files;
record a missing-cache limitation. Never stage fixture bytes or mutated outputs.

The integration owner verified existing cached `IXPE-Presentation-Template.pptx`
and `WWL-template-1slide.pptx` against their manifest hashes. Both have slide
12192000 × 6858000 EMUs and notes 6858000 × 9144000 EMUs. Existing presentation
properties are 818 bytes; view properties are 773 and 935 bytes respectively.
These are corpus facts, not original unit fixtures or product assets.

For each admitted cached document:

1. Inspect settings through the public SDK and configured CLI; independently
   inspect the original ZIP/XML settings values and compare results.
2. Resize a disposable copy canvas-only and change an explicit slideshow option
   and numbering. Reopen it and verify requested settings, package validity and
   byte identity of every non-targeted part, including slide shape geometry,
   notes content, view/print settings and vendor extension subtrees.
3. Exercise notes orientation/dimensions independently. Assert slide dimensions
   and all slide content remain unchanged.
4. Attempt explicit scale-content on supported geometry or check the documented
   unsupported result. Compare independent coordinates rather than relying only
   on the production inspector or on successful archive opening.
5. Reduce meaningful findings to small original in-memory regressions and rerun
   maintained focused checks. Keep disposable outputs under ignored cache paths.

## Evidence receipt

Research review found eight direct source dimension unit variants and two expanded
BDD scenarios. Adjacent notes-owner/save and all length variants remain recorded
without claiming implementation. The first-slide-number spec bound is corrected
from a safe JS integer to the signed OOXML 32-bit range. New notes/scale flags
require synchronized schema/spec documentation.

The integration owner completed the first source-SDK corpus pass on both admitted
fixtures. Orientation became portrait at 6858000 × 12192000 EMUs; notes became
landscape at 9144000 × 6858000 EMUs; numbering became 7 with looping window mode.
Independent ZIP/XML checks found unchanged member sets and changes only in
`presentation.xml` and `presProps.xml`. Vendor extension XML remained intact and
every other entry was byte-identical. Disposable outputs are ignored cache files
`qa-settings-a.pptx` and `qa-settings-b.pptx`. Final built-package results follow.

Independent review identified negative half-rounding in content scaling,
nonidentity root group transform handling and root-level main-part relationship
creation as concrete regression candidates. The domain worker owns failing
original tests and fixes; the research worker does not edit product files.

Completed original TDD cases cover absent/present axes, source numeric edges,
paired repair versus axis-only model writes, preserved package/settings bytes,
signed numbering, notes zero, schema consistency and supported/rejected scaling.
Independent review findings became original regressions for negative halfway
rounding, root-level main-part relationships, nonidentity root group transforms,
orientation write bounds, square portrait requests and boolean flag admission.

Passed maintained `npm run test --workspace=pptx`: 1,013 tests in 36 files.
The final focused settings suite passes 32 tests, including two added exact
axis-only source variants. Zero-delay cooperative scheduling uses the existing
test-suite setImmediate technique to keep these in-memory cases fast.
Passed `npm run lint --workspace=pptx` including both TypeScript projects.
Passed `npm run build:workspaces -- --workspace=pptx`: declared build closure
office-package, toolcraft-schema and pptx. Built output freshness was verified
against all changed source modules. The registered Shell file passed 24 tests
using `node --import tsx --test packages/safe-bash/tests/commands/pptx/create.test.ts`.
Scoped ESLint on that Shell file also passed. No whole-pipeline or repository-wide
test run was used as a substitute.

Final review reproduced eight malformed group child-coordinate admissions, then
verified all eight fail safely after finite integer syntax/range checks. The
13-test scaling helper suite passed; package tests, lint and the selected build
closure were rerun after this correction, followed by the actual Shell suite.

## Final disposable QA receipt

Built public SDK verification repeated manifest SHA-256 admission for both
fixtures. Canvas portrait, notes landscape, numbering 7, loop true and window mode
succeeded. Independent Python ZIP/XML assertions verified identical member sets,
only presentation.xml/presProps.xml changed, expected requested values and retained
vendor extension XML. Every other part retained its exact bytes. Separate notes
edits to 6400800 by 8229600 EMUs changed only presentation.xml and preserved slide
size/content. Both real decks rejected unsupported content scaling without output.
An original built-SDK deck scaled coordinates (-3,7) to (-5,14) and extents
(101,203) to (152,406), independently checked from ZIP/XML.

Actual built command help, settings read and contradictory-orientation error were
captured with the maintained `scripts/screenshot.ts` renderer and visually inspected.
Settings flags and diagnostics are readable; the existing full help remains tall.
This direct runner avoids the root poe-code predev build and exercises the same
terminal renderer. No screenshot unit tests or application-rendering claims.
Artifacts are confined to ignored `.cache/pptx-corpus/qa-settings-*` paths:
two edited decks, two notes-only decks, an original scaled deck and help/read/error
text/PNG captures. No downloads, shipped fixtures or README changes.

The supplemental receipt accounts for all eight direct unit variants and two
expanded dimension scenarios. Twenty-two adjacent cases and 71 live-model/value
API records remain explicit obligations; no full model, batch or format parity
is claimed. Canonical command research distinguishes implemented direct subsets
from proposed grid/view edits and batch/model routes.

## Local delivery

Stage only the owned settings/scaling modules and tests, command/schema/value
changes, public index, registered Shell test, this plan, settings research/usage,
command research correction and format-spec correction. The cohesive settings
feature receives a Conventional Commit on main after verification. Its hash is
reported in chat; no push, remote-main delivery or release is authorized here.
