# Bounded DOCX preserving text replacement

Scope: only the original TypeScript utility's literal replacement task. Work is
on main, with one owned atomic feature commit and no push or release. Later
model APIs, typed batch execution and other editing tasks remain pending. The
independently modified pipeline plan and historical evidence remain untouched.

## Failing tests before implementation

- Sixteen original memfs cases failed because the replacement API was absent.
  A seventeenth failed for the missing owned XML subtree-edit primitive.
- Implemented matching across adjacent formatting runs, barriers and checked
  selections in packages/docx. No reference runtime, downloaded fixtures,
  product networking or ambient host I/O was used.
- The CLI regression failed with unsupported-profile before wiring the existing
  command engine to the same replacement SDK and publication implementation.
- Additional failures exposed identical-substitution generation drift, lost
  local formatting namespace bindings, and equal-text cross-run formatting.
  Reduced each to a small original regression and fixed it before proceeding.
- Existing discovery tests exposed their now-stale replacement rejection claims.
  Retained original test names and cases, updated replacement support assertions,
  and retained rejection coverage using the still-pending images operation.
  New affected-count and capability assertions failed before their schema fixes.
- Final review added a failing comment-lookalike case: raw string searching
  could target markup inside a comment. Run composition now uses the XML
  parser's owned source spans. Formatting-property revisions are isolated and
  rejected after another failing original regression. Screenshot review found
  singular-result wording; a failing CLI assertion preceded its correction.
- An exact output-limit regression failed before including the JSON transport
  newline in prepublication accounting. Binary-stdout receipts now also budget
  the actual null output path representation.

## Exact behavior and mappings

`replaceDocumentText(input, options, context)` always returns a Promise. Input is
owned Uint8Array data; output uses explicit byte sinks or capability-scoped VFS
publication. It shares the `text.replace` command schema, selector validation,
budgets, signature/protection guards and atomic publication. CLI options retain
camelCase JSON fields and common exit/error/JSON rules. No host clock, fonts,
filesystem, field execution or network authority is inferred.

The paragraph map keeps leaf-to-run ownership. Literal matches are computed
left to right, nonoverlapping, before any edit. Search text is never a regex.
Checked selector ranges count Unicode scalars; implementation search indices are
UTF-16 offsets only after scalar boundaries and well-formed strings are admitted.
Missing/stale/invalid selections retain the existing typed error codes. Exactly
one first/all/occurrence is mandatory, including one-match cases. Out-of-range
occurrences and absent matches fail unless allowEmpty is explicitly true.

Paragraph, object, field-phase, revision, hyperlink, content-control and opaque
container edges stop matching. Hidden text is included. Final/original/all views
follow extraction policy; cached field results may be replaced within their own
boundary while instructions remain byte-exact and inert. Simple insert/delete
content is supported; move and formatting-property revisions reject editing. Shared headers/footers
reject ambiguous edits; cloning remains a later task. Locked controls and signed
or protected packages retain the existing conservative edit refusal.

Default replacement inherits all first-run properties by editing text leaves in
place; unmatched run content/properties and unrelated XML remain. Explicit bold
and italic booleans split runs only around inserted content and override only
those properties, retaining namespace bindings and inherited properties. Empty
replacement retains required paragraphs. Generated text has xml:space=preserve;
tabs become tab elements and CR/LF become line-break elements. No Unicode
normalization, shaping or style cascade occurs.

Changes count matched replacements and carry their owning paragraph locations
before/after one generation increment; several matches can share a paragraph.
An equal-text replacement wholly within one run with no formatting override is
a byte-exact no-change operation. Equal text spanning runs still inherits the
first matched run's formatting. Dry-run validates prospective edits but publishes
nothing. Output and match ceilings fail before publication.

The API audit and full 920-record inventory were read as research inputs. This
utility is separate from model Paragraph.text/Run.text setters and clear():
their destructive scope, neutral spelling and synchronous live-model semantics
remain planned. No inherited member, underscore-prefixed public type, enum,
collection, helper or untested public API is hidden or promoted as implemented.
The established JS mappings (async admission/publication, scalar/sequence index
distinction, null/inheritance, typed units/enums/errors, explicit time and VFS)
remain unchanged. Updated the authoritative replacement argument row and its
command register for optional bold/italic overrides and bounded direct support;
typed batch and unsupported selectors remain explicitly pending.

## Maintained checks and manual QA

Run the DOCX workspace test/lint routes and selected DOCX build closure. Verify
root browser exports and the existing safe-bash DOCX registration route. Execute
the real Shell adapter with original in-memory data for dry-run, publication,
selection errors, Unicode/control text and CLI/SDK equivalence. Inspect a terminal
screenshot of actual replacement help/results. QA artifacts remain disposable
and unstaged; this is not document rendering or full model conformance evidence.

Final results on 2026-09-14:

- `npm run test --workspace=docx`: 850/850 tests, 34 files, no skips.
- `npm run lint --workspace=docx`: ESLint and production/test TypeScript passed.
- `npm run build:workspaces -- --workspace=docx`: all five declared build tasks
  and applicable lifecycle checks passed, uncached.
- Root `scripts/docx-exports.test.ts`: 2/2, including browser portability.
- Safe-bash `node scripts/test-reporting.mjs --import tsx
  tests/commands/docx-registration.test.ts`: 10/10, no skips. An earlier command
  omitted the maintained TS import hook and failed module resolution; it is not
  counted as a test pass. The corrected route passed twice.
- Initial manual Shell QA: 10 calls verified output/conflict/force/in-place,
  deletion, cardinality/missing matches and SDK/CLI equality. Four additional
  human-output calls supplied screenshot review and exposed singular wording.
- Final built-package manual QA: six Shell calls passed. Exact Unicode,
  combining marks, tabs/newlines and inserted bold=false/italic=true properties
  matched expectations; dry-run JSON data equaled SDK data; input stayed exact.
- Inspected `/tmp/docx-text-replacement-final-20260914.png`: readable help,
  explicit cardinality, corrected one-match result, extracted text and usage
  error. Capture uses 96-column terminal wrapping. Earlier oversized JSON capture
  was unsuitable for viewing; final human-output capture is the review evidence.
  All screenshots remain disposable and unstaged.
- `git diff --check`: passed.

Deliver this as one atomic local feature commit with the exact owned paths.
The local hash is reported after Git creates it. No remote delivery or release
is claimed, and all later tasks remain pending.
