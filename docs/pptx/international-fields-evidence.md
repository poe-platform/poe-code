# International text and caller-controlled fields

This receipt covers the F20/F21 increment. It supplements the pinned
[test audit](upstream-test-audit.md), [API audit](upstream-api-audit.md) and
earlier text/font receipts; it does not claim whole-public-API coverage.
The [exact ledger](international-fields-case-map.json) retains 48 unit variants,
23 expanded BDD examples and 252 affected API records, including inherited
shape text members and the complete language enum/helper inventory.

## Source accounting

Selection includes all language and Latin-font cases, all text-model text
getter/setter cases, field-bearing resolved unit fixtures and expanded text BDD
examples. Each source row links to its resolved semantic evidence and earlier
bounded adaptation receipts where present. Multiple source rows remain separate
even when null and an enum sentinel share one operation-layer XML outcome.
Existing run-formatting tests preserve the regional language transitions and
inheritance-removal boundary. Existing reading tests distinguish cached fields,
runs and breaks. These assertions establish bounded observable behavior only.

No selected source case establishes explicit cached-value updates, caller time,
script-specific font editing, emoji shaping, bidi visual reordering or vertical
layout. Original supplemental tests must establish the newly offered metadata
and edit behavior. No amount of source inventory accounting proves rendering.

## JavaScript and security mappings

Text is a JavaScript Unicode string. Extraction preserves document structural
order and code points; it does not normalize combining sequences or infer visual
bidi order. Replacement must preserve surrogate boundaries. Font-family and
script attributes are declarations: they cannot discover, download or install
fonts, select platform fallbacks or imply complex shaping support.

The run operation extends `TextRunFormatting` with nullable `eastAsiaFont`,
`complexScriptFont`, `symbolFont`, `alternateLanguage` and `rtl`. Separate
complex-script classification options retain signed-byte `complexScriptCharset`,
valid OOXML `complexScriptPitchFamily` values and a 20-hex-digit
`complexScriptPanose` normalized to uppercase. Invalid declarations fail before
input admission. Changing a typeface preserves unrelated font attributes;
clearing classification cannot silently create a font without a typeface.
The matching flags use kebab-case on `text runs set`, with generated schema
discovery and the same SDK validation.

Original `international-text.test.ts` cases exercise script declarations,
nullable merges, malformed attributes and Strict versus Transitional boolean
tokens. A command test compares SDK/CLI output bytes and independent SAX
attributes. The mixed-script resolution test asserts each property's distinct
run/paragraph/layout/master/theme provenance; replacement tests preserve
combining marks and a ZWJ emoji across adjacent runs. Existing frame support
retains vertical-writing metadata separately from run direction.

Byte-oriented operations remain asynchronous and use camelCase option JSON.
The documented neutral object-model properties remain direct properties with
their original spellings. Operation `language` string/null metadata does not
implement `Font.language_id` or `MSO_LANGUAGE_ID` symbols. Their entire public
inventory remains visible, including enum helpers and inherited metadata.
Underscore-prefixed run/paragraph types remain public returned-model obligations.
Existing detached frame support is not complete live shape-owner support.

Absent options retain local overrides; explicit null removes a nullable override.
Reading effective formatting must preserve provenance and must not materialize
inherited layout/master/theme values into the package. Declaring RTL or vertical
metadata is separate from computing text layout. Existing vertical-anchor enums
describe alignment and must not be relabeled vertical-writing coverage.

Field cached text is input, not an instruction to evaluate a date or slide
number. `preserve` retains the existing cache. `explicit` requires caller text;
date fields also require an explicit UTC timestamp. System time, native
applications, host filesystem access, external resources and automatic field
evaluation are not implicit capabilities. Reads remain noncreating. Unknown
field types and vendor metadata require preservation through unrelated edits.

`readFields(input, options, context)` returns an array of records containing
location, zero-based paragraph/inline coordinates, nullable kind/ID/type and
cachedText. Unknown types stay visible with null kind. `mutateFields(input,
action, options, context)` accepts `set | add | remove` and returns bytes,
affected count and locations. `FieldUpdate` takes optional kind, text,
`update: preserve | explicit` and `timestamp: Date`; command JSON carries an
explicit UTC date string admitted to that SDK Date value. `fields list/get`
use the shared resource envelope; `fields set/add/remove` use the shared
mutation envelope and publication controls. No timestamp formats a cache.

Original `fields.test.ts` and `command-fields.test.ts` cases verify all four
kinds, mixed-script caches, preserve/explicit policy, missing or inapplicable
timestamps, unknown field metadata, cardinality and closed schemas. The
registered safe-bash field acceptance test exercises the adapter path. The
final field suite has 16 unit and 19 command cases, including three original
inline-coordinate and foreign-namespace regressions. Coordinator verification
passed all 1,897 tests across 72 package files, maintained package lint, the
selected pptx build, and all four focused registered-shell pptx files against
the rebuilt package. Focused adapter-test lint also passed.

Direct `mutateTextRuns(text)` and `text runs set --text` now serialize forbidden
C0 characters as uppercase `_xHHHH_` text. TAB/LF/CR remain literal run content;
VT inside a run becomes `_x000B_`, unlike frame assignment's soft-break behavior.
Existing literal escape spellings are neither decoded nor rewritten. Lone
surrogates and invalid XML scalar values still fail before package admission.
Fourteen original tests in `text-run-assignment.test.ts` independently parse
persisted XML, compare SDK/CLI bytes, retain input bytes and cover these scalar
boundaries. The focused four-file check passed 115 tests; maintained package lint
passed ESLint and both TypeScript configurations.

## Evidence status and drift

The audit's historical statement that no TypeScript implementation exists is
superseded only for capabilities with actual bounded receipts. The global
inventory remains a research baseline, not a pass list. Unsupported full model
members remain explicit in this increment's ledger.

Actual worker test names are linked in the ledger. Supplemental originals
establish the bounded operations above. Live paragraph/run destructive setters
and complete enum/owner-model coverage remain explicit gaps; no operation
assertion is relabeled as a live-model pass. Research validation checked all 71
unique source identities, 252 API identities and their inventory pointers.
The [accounting and QA procedure](../plans/pptx-international-fields-accounting.md)
is kept in `docs/plans`. The corpus manifest was reviewed; this accounting task
did not download, execute, copy, alter or remove disposable fixtures.

Research identities occur only in the linked research inventories. Existing
[standalone MIT notice](upstream-license-notice.txt) and
[case provenance notice](test-case-map-notice.txt) are retained. This task copies
no implementation or fixture material into product source or tests.
