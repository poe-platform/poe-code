# Bounded DOCX creation task

Task: `create-documents-and-templates`. Only this task is owned here. The existing
pipeline file had unrelated edits at entry and remains untouched; later tasks
retain their pending status. Entry commit:
`fc990491743594954c051b03e00388291680f153` on main.

## Scope and contract decisions

Extend the original archive creator and shared command engine. Keep root wiring
and safe-bash adapters unchanged. Implement typed blocks, deterministic package
generation, explicit new-package page/style/theme settings and supplied-template
body appends. Retain kind/dialect on templates and preserve unrelated parts.
Template page/theme/metadata overrides reject explicitly; this task does not
implement the later resource setters or content-control binding engine.

No network, reference runtime build, downloaded fixture, host document I/O,
executable template or third-party asset is used. All authored regression content
is original and small. Unit filesystem mutation uses memfs. Existing tests remain,
with exact discovery inventories expanded to include the newly supported create
operation. Historical evidence and unrelated files are preserved.

## Language/security and documentation reconciliation

Read the complete 920-row JSON inventory and the API audit/reconciliation. The
documented Document factory, add_paragraph/add_heading/add_table/save, inherited
members, underscore-prefixed public types, enums, collections and untested public
APIs remain planned model work. This utility does not rename them or claim their
implementation. The shared model spelling remains snake_case; operation options
are camelCase. No blanket alias layer is introduced.

Exact creation mappings: owned Uint8Array template input; always-async creation
and publication; injected VFS/streams; closed structured content; optional
undefined means absent and explicit null is rejected outside nullable run flags;
finite safe values without coercion; lengths convert to integer EMUs then twips
or half-points with positive halfway rounding (negative creation geometry rejects
before rounding); explicit UTC time truncated to whole seconds; exact named style
lookup and collision-free local IDs; typed neutral usage/unsupported/limit and
publication errors. Strings are escaped XML data, not expressions. No font,
identity, time or external-relationship discovery.

The full proposed spec retains its Not applicable implemented-version marker.
Its content declaration now includes the requested creation settings, resolving
the omission between the bounded task and its former blocks-only schema.
Current utility evidence is separate in `docs/docx/creation.md`. No historical
model audit or research count is rewritten as a product conformance claim.

## Failing tests before implementation

- Initial two creation suites: 9 failures. Archive options rejected content and
  templates; command create was unsupported; file JSON lacked engine acquisition;
  schema reported create as rejected.
- Explicit metadata regression failed because the new creator used the wrong
  timestamp schema discriminator; corrected to the maintained UTC instant type.
- Memfs publication ownership regression failed with ENOENT at the original
  output because caller mutation redirected the awaited creation; fixed by
  owning publication intent before admission awaits.
- Missing-template-styles regression failed with unsupported-edit; now adds a
  scoped relationship/content type and allocated styles part when needed.
- Negative-margin regression proved rounding could admit a tiny negative value;
  signs are now checked before conversion. Font sizes that round to zero reject.
- Original dialect test detected null silently taking the new fallback; fixed
  with explicit kind/dialect validation before defaulting. No original dialect
  assertion was weakened.
- A custom style named Heading 1 initially suppressed the requested outline
  level. The failing collision regression now passes with a distinct style while
  preserving the original definition; matching real outline styles may be reused.
- The existing independent Word-reference helper assumes word/styles.xml. For
  allocated template style paths, the new test uses independent namespace-aware
  reference checks and package-link checks instead; the original helper and its
  tests are preserved.

## Verification procedure

Run maintained DOCX workspace tests and lint, selected workspace build closure,
existing safe-bash document adapter tests and root public-export tests. Exercise
actual Shell create from inline JSON/file/stdin, binary pipes, JSON dry-run,
template append, kinds/dialects and conflict behavior. Inspect screenshots of
actual command help/output via the maintained terminal renderer; this plugin is
not a root poe-code subcommand. Keep manual QA artifacts disposable and unstaged.
No QA driver becomes a product script or canonical test.

Final results and owned local commit are recorded after verification. No push
or release is authorized.

## Completed verification — 2026-09-14

- `npm test --workspace=docx`: 816/816 tests in 33 files, no skips.
- `npm run lint --workspace=docx`: ESLint and production/test TypeScript pass.
- `npm run build:workspaces -- --workspace=docx`: all five builds in the
  maintained declared dependency closure pass, including lifecycle checks.
- Existing safe-bash `xml-parts.test.ts`, `io.test.ts` and
  `docx-registration.test.ts`, through node --import tsx --test: 28/28, no skips.
- Root public export/browser closure suite: 2/2.
- Specification checker: zero errors and warnings; full proposal metadata remains
  unchanged because this is only one bounded utility milestone.
- Manual QA: 11 actual Shell calls, using the built DOCX package and original
  in-memory data. Verified Strict DOTX with theme, content-file, literal JSON,
  stdin and binary pipes/redirection, independent package assertions, exact SDK
  text equality, supplied-template append, unchanged template bytes, JSON
  dry-run, kind/dialect conflict, shared-stdin preflight and blank creation.
- Inspected `/tmp/docx-creation-help-20260914.png` and
  `/tmp/docx-creation-output-20260914.png`. Help/settings and diagnostics are
  legible. The bundled capture font lacks CJK/Hebrew/emoji glyphs; exact Unicode
  assertions pass. This is terminal QA, not document-rendering or repair-warning
  qualification. Both PNGs and temporary logs remain disposable and unstaged.

One atomic local feature commit includes implementation, original regressions,
the narrow spec declaration and this record. No later task, unrelated pipeline
edit, archive move or QA fixture is included. The resulting hash is reported in
the completion response; no push or release is performed.

## Verification review — 2026-09-14

Reviewed entry commit `6ed37ca31aca9bd87f7be5baa1748c1fefe6359a` against this
bounded task, the format specification, shared CLI/SDK contracts and the API
audit/inventory. Existing unrelated pipeline edits and archive moves remain
untouched; the index was empty at entry. No implementation replay or reference
runtime execution was used.

The original creation red sequence is recorded above. Available historical logs
were inspected: the first whole-workspace green has 815 tests and the final green
has 816, consistent with the later heading-collision regression. Standalone logs
for that implementation's initial red sequence were not located, so that red
history is documentary evidence, not independently replayed evidence.

One new defect was reproduced with original memfs package-output tests before
changing product code: a 12.24-point named style serialized as 25 half-points
instead of 24. Rounding through integer twips introduced a second quantization.
The fix converts to integer EMUs, then rounds directly to half-points; page/table
twip conversion, negative-value rejection and the prior admitted upper length
bound remain in place. The 12.25 and 12.26 boundary cases, both dialects and
independent ZIP/CRC/namespace-aware XML assertions cover the correction.

Evidence: `/tmp/docx-creation-review-rounding-red2.log` records the actual product
failure (expected `24`, received `25`), with the two neighboring cases passing.
The preceding `rounding-red.log` exposed an error in the newly authored assertion's
document-root traversal; it is retained and is not product-defect evidence.
The focused green log records 17/17 creation and command tests. Logs are disposable
and are not staged.

Maintained review checks:

- `npm test --workspace=docx`: 819/819 in 33 files, no skips.
- `npm run lint --workspace=docx`: ESLint and production/test TypeScript pass.
- `npm run build:workspaces -- --workspace=docx`: five declared dependency-closure
  builds pass with lifecycle checks.
- Existing safe-bash `xml-parts.test.ts`, `io.test.ts` and
  `docx-registration.test.ts` through `node --import tsx --test`: 28/28, no skips.
- `npx vitest run scripts/docx-exports.test.ts`: 2/2.
- Built CLI/SDK memfs creation comparison: identical 2,363-byte packages;
  independent styles XML contains `<w:sz w:val="24"/>`, with empty stderr.
- Read-only adapter review executed 13 actual Shell calls: repeatable creation
  across DOCX/DOTX and Strict/Transitional, Unicode, blank five-part output,
  template append/payload retention, JSON dry-run, shared-stdin rejection and
  executable-field rejection. Product filesystem calls were guarded against use.
- Inspected the two existing creation PNGs listed above. Help and diagnostics
  are legible; the previously recorded missing terminal glyphs remain visible.
  The correction changes package font-size values, not CLI presentation.

The 920 inventory rows still comprise 410 planned, 378 security-mapped,
124 language-mapped and eight documentation-error records, with zero implemented
model rows. Neutral model spellings, inherited/underscore-prefixed public APIs,
enums and collection obligations remain accounted for in the research register.
Creation retains the documented asynchronous owned-byte/VFS boundaries, closed
nonexecutable content, explicit time/identity and integer-EMU language mapping.
This review does not promote model coverage or alter the full proposed spec's
implementation marker.

Gaps: no full OOXML schema certification, document-rendering/repair-warning QA,
browser runtime qualification or complete model API conformance is claimed.
Prior screenshot inspection is not a new document render. The task's maintained
scoped checks pass; repository-wide unrelated checks were not run. Commit only
the font-rounding correction, its original regressions and this appended record,
using a local Conventional Commit on main. No push or release.
