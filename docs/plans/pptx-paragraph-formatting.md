# Paragraph formatting implementation and verification

Implement the requested paragraph formatting slice in `packages/pptx`, with
safe-bash adapters under its pptx command folder and root public wiring only.
The shared office CLI/SDK contracts govern selectors, lengths, JSON and errors.
No whole pipeline, push, release, README edit or downloaded fixture commit.

## Ownership

- Paragraph engine owner: domain formatting, XML application and domain tests.
- Adapter owner: common command/schema and safe-bash argument parity.
- Audit owner: independent cases, paragraph case map and usage/research notes.
- Coordinator: public wiring, cross-surface verification, disposable corpus QA,
  maintained checks and atomic local commits on main.

## TDD evidence

The audit owner's original `paragraph-formatting-cases.test.ts` was run before
`text-paragraphs.ts` existed. Vitest failed module admission as expected. Its
literal XML cases independently exercise expanded before/after and line-spacing
states, clearing, zero and all alignment/level values. No filesystem fixtures,
network, fonts or native runtime are required by these tests.

## Research accounting

The pinned inventory at commit `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`
contains 40 relevant paragraph-formatting unit variants and 22 relevant BDD
examples, including the placeholder level roundtrip. The case map records each
source identity separately. All 30 public paragraph/alignment inventory rows
remain visible, including inherited enum metadata and the returned paragraph
interface's other members. Original wording/XML replaces reference fixtures;
existing standalone MIT research notice remains retained.

Preserve the lexical percentage line spacing case (`124.64%` means 1.2464
lines). Before/after percentage nodes have no absolute point getter value.
Source level zero drops the attribute; this implementation intentionally keeps
explicit zero distinct from omitted/null at the operation level. The model
getter's absent level still needs documented default-zero semantics.

## Agent-executed QA procedure

1. Run focused original domain and independent tests and package lint. Fix any
   issue with a small original regression before marking its case implemented.
2. Verify identical mutations through SDK and safe-bash CLI, schema/capabilities,
   selection failures, explicit output, dry-run and atomic invalid-input rejection.
3. Inspect an original package's XML directly for paragraph child order, exclusive
   bullet/numbering choices, unit conversion, tabs and retained mixed runs.
4. Use only entries from `docs/pptx/corpus-manifest.json` as disposable QA inputs.
   Inspect relevant inherited list styles and local overrides; perform an edit
   on disposable copies and compare untouched parts. Never add corpus bytes to
   source or make unit tests depend on their presence or download.
5. Run the maintained screenshot command for CLI-visible changes and visually
   inspect output. This is manual QA, not a screenshot unit test.
6. Record relevant maintained check results and local commit hashes separately.
   No push or release is authorized by this task.

## Verification record

Initial independent-test red phase: missing paragraph module, no cases falsely
reported as passes. Review findings were reproduced before fixing numeric CLI
coercion, numeric JSON lengths with exponent notation, colliding rounded tabs,
unknown tab-list extension retention, malformed XML and enum mutability.

Final checks after all workers handed off stable source:

- `npm run build:workspaces -- --workspace=pptx`: selected maintained closure passed.
- `npm run test --workspace=pptx`: 60 files, 1,649 tests passed.
- `npm run lint --workspace=pptx`: ESLint and source/test TypeScript passed.
- The three existing safe-bash pptx command test files: 87 cases passed against
  the final build. Focused ESLint passed on the edited adapter test.
- Owned code and JSON passed Prettier checks; `git diff --check` passed.
- The spec checker passed without warnings; paragraph grammar and the operation
  research register now include units, margins, line spacing and nullable edits.
- Final built SDK/CLI corpus QA again produced identical bytes, retained all
  text and 37 untouched members. See `pptx-paragraph-corpus-qa.md`.
- Scoped help/error terminal screenshot reviewed; see `pptx-paragraph-cli-qa.md`.

The first coordinator suite overlapped the workers' final TDD red cases and
therefore failed two new assertions. After those fixes and stable handoff, the
complete maintained package suite above passed. No failing result is counted as
a pass. Whole live-model graph coverage is not claimed: unrelated paragraph
text/run/font/parent methods and table/cell-specific selection remain visible
planned obligations. Standalone paragraph formatting properties, length values
and alignment conversion/metadata have original executable evidence.

Length values are one atomic local commit; paragraph model/commands, their
schema and relevant research/QA are the second. No push or release.

Audit checkpoint: 69 independent paragraph-formatting cases and 25 alignment
conversion cases passed. Alignment helpers had a separate red phase before
`paragraph-alignment.ts` existed. Numeric enum metadata is explicitly mapped to
`metadata(value)` returning immutable metadata. Length helper accounting adds
13 source variants and 56 public/inherited API rows, including deliberate J05
rounding differences. The model now returns Length rather than point records.

The original independent assertions cover each concrete source spacing state
and transition. BDD primitive `.pt` access is tested using JavaScript narrowing:
null raises native TypeError; a numeric multiple has undefined `.pt`; an
absolute Length exposes points and EMUs. Graph methods unrelated to formatting
remain visible in the case map and are not counted as whole-model parity.

Enum immutability regression: an independent test first failed because the
numeric enum object was mutable. Wrapping its assembled values/helpers in
`Object.freeze` made runtime mutation reject and exposes readonly TypeScript
properties. Final focused audit run passed 95 tests (69 paragraph, 26 enum).
