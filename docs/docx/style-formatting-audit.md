# Style and formatting implementation evidence

The format package now implements the bounded live styles, latent styles, Font,
ParagraphFormat and TabStops subgraph, its required formatting values, and
SDK-backed style/formatting command operations. Original in-memory tests cover
inherited character/paragraph/table interfaces, nullable formatting, named style
lookup, latent defaults/overrides, tab insertion/deletion/clear and movement,
Title through heading level 0, enum facts and explicit I/O ownership.

The [case map](style-formatting-case-map.json) links all 613 selected API rows and
898 selected source cases to named original tests and explicit dispositions.
Those are research-selection counts, **not** 613 implemented methods or 898 newly
executed tests. The selection includes 224 enum-value facts, inherited rows,
language/security mappings and related general Document/Paragraph/Run/Table
owner bindings. The latter remain separately identified; this task does not
complete the general document model or later feature tasks.

## Verification

An independently executed focused run passed nine suites and 443 tests:
`styles-model-boundaries`, `styles-model`, `formatting-model`,
`formatting-model-boundaries`, `formatting-values`, `style-formatting`,
`font-tabs`, `styles-command` and `paragraph-edit`. The exact command, scope and
counts are recorded in `STYLE-FINAL-RUN-01` in the map. This receipt precedes the
final enum-string/WD_COLOR alias additions; the root task's maintained workspace
checks are authoritative for the final combined checkout. The completed maintained
DOCX workspace run passed 52 suites and 1,388 tests in 38.48 seconds
(`STYLE-WORKSPACE-RUN-01`), including both final additions. Counts from separate
runs are never added together as though they were one execution.

All 1,886 API/source links and 13 additional regression links were checked against actual test files
using the TypeScript parser, including parameterized title patterns. Source row
IDs, JSON pointers and uniqueness were checked independently. The map preserves
exact source parameter/step witnesses through pointers to
[test-case-map.json](test-case-map.json); it does not copy external assets into
the original tests. API rows retain their original IDs and proposed signatures,
with explicit actual mappings where the JavaScript surface differs.

The scoped boundary suite includes 31 style/latent tests and 224 independently
pinned enum numeric/XML fact cases. All 184 style unit variants and 97 style BDD
scenarios have specific model-boundary mappings. Formatting raw-state matrices
cover Font booleans/baselines/name/size/underline/highlight/color, paragraph flags,
indentation/spacing/line rules and tab properties. Utility tests separately cover
preservation, publication, sorted insertion/deletion, direct options and discovery.
Many-to-one mappings state the observable equivalence; an original small unit
scenario is not represented as execution of the external BDD runner.

## Implemented boundary

| Family | Verified behavior | Boundary retained |
| --- | --- | --- |
| Styles | Live keyed collection, aliases, creation, deletion, default/ID lookup, next/base, priority and visibility; character/paragraph/table inheritance | Whole Document/Paragraph/Run/Table owner classes remain outside this standalone style-model factory |
| Latent styles | Four boolean defaults, nullable priority/count, nullable individual overrides, duplicate live entries, first named lookup, iteration/deletion/invalidation | CLI ambiguous selectors still reject; model collection semantics remain distinct |
| Font | All 22 boolean/baseline flags, name/size, underline/highlight, live color view and explicit null/false | No font discovery, rendering or effective page layout |
| ParagraphFormat | All documented scalar properties, typed lengths, spacing rules and tab collection | The style getter exposes direct nullable values; effective utility inspection is separate |
| TabStops/TabStop | Numeric/at access, negative indexes, length/iteration, sorted add/move, delete/clear, leaders, ownership and stale deleted handles | No accidental slice API; opaque trivia can require preserving an otherwise empty container |
| Values | Callable immutable lengths, RGB helper, enum symbols/aliases, numeric/XML facts and explicit metadata helpers | No Python integer subclass or executable enum properties in transport records |
| XML/part views | Bounded parsed snapshots, owner equality and owned part bytes | No full external XML-library API, unrestricted mutation or ambient host access |

`openDocumentStyleModel` is async; admitted style and formatting model operations
are synchronous; save remains async and validates before explicit publication.
The domain implementation lives in `packages/docx`; CLI and typed model batches
invoke the SDK. Shared plural resources, common options, selectors, versioned
JSON, exit statuses, schema and capabilities remain authoritative. Read-only
style inspection does not invoke the creating latent-style getter.

## Exact model and source semantics

The finite built-in UI/internal-name map is Caption/caption, Footer/footer,
Header/header and Heading 1–9/heading 1–9. Arbitrary custom names remain exact;
Title remains Title. Name lookup precedes deprecated ID fallback, which produces
an explicit `deprecated-style-id-lookup` warning without ambient console output.
Membership is name-only. A missing name is different from an explicit empty name.

`default(type)` selects the last matching default in document order.
`get_by_id(id, type)` falls back for null, empty, missing or wrong-type IDs.
`get_style_id(styleOrName, type)` returns null for null or the default style,
returns a matching nondefault ID, and rejects missing names/wrong types/owners.
A dangling applied reference may fall back; assigning a misspelled name fails.
Deleting a definition preserves applied references and content, supports saving
that fallback state, and invalidates prior handles.

`CharacterStyle` inherits BaseStyle and adds `base_style`/`font`;
`ParagraphStyle` adds `paragraph_format`/`next_paragraph_style`; `_TableStyle`
inherits those paragraph-style members. `_NumberingStyle` retains actual
BaseStyle members without invented Font/paragraph/base properties. Public
underscore-prefixed names remain exported and mapped. An absent, dangling or
nonparagraph next reference returns self; assigning self or null removes next.
Applying `unhide_when_used` does not automatically unhide a definition.

Defined-style visibility/locking/gallery flags read false when absent; false/null
assignment removes the explicit child. Font flags preserve explicit false.
Latent override absence reads null; latent default booleans read false and their
setters reject nonbooleans. Latent default priority/load count remain nullable.
Duplicate latent entries retain separate identities, with first named lookup;
deleting and recreating a name cannot resurrect an earlier handle.

Font boolean-or-null fields are `all_caps`, `bold`, `complex_script`, `cs_bold`,
`cs_italic`, `double_strike`, `emboss`, `hidden`, `imprint`, `italic`, `math`,
`no_proof`, `outline`, `rtl`, `shadow`, `small_caps`, `snap_to_grid`, `spec_vanish`,
`strike`, `subscript`, `superscript` and `web_hidden`. Subscript/superscript share
vertical-alignment storage and retain exact cross-mode false/null behavior.
Underline accepts boolean, supported enum or null; enum membership alone does
not imply that every sentinel is accepted by a setter.

Tabs default to LEFT/SPACES, accept negative distances and insert in order.
Leader null/SPACES removes explicit leader state. Movement keeps the logical
handle attached to the replacement tab; unrelated paragraph changes preserve the
handle; deletion invalidates it. Source private wrapper identity is replaced by
observable owner/node identity. Readonly XML snapshots are not promises of a
complete mutable XML object model.

## Language, security and documentation reconciliation

| Source/register issue | Actual mapping |
| --- | --- |
| D04 / enum sentinels | Preserve documented symbols/aliases; reject unsupported INHERITED/NOT_THEME_COLOR setters and literal UNMAPPED XML representations |
| D05 | `priority`, actual inheritance, ParagraphStyle and `_LatentStyle`; no typo or obsolete printed-type aliases |
| D06–D07 | String-keyed style lookup, finite aliases, retained spaces, warning on deprecated ID fallback; no ordinal/enum lookup |
| D08 | Missing named assignment fails; dangling applied references use fallback; delete preserves content |
| D22 | Concrete style flags read boolean; latent override flags read boolean-or-null |
| D23 | Tab handle follows movement; explicit snapshots are bounded read views, with logical tab invalidation checked separately |
| Newly found name/ID drift | BaseStyle `name` and `style_id` are nullable read/write, including inherited copies; null removes their XML state |
| Enum metadata/protocols | Immutable `{enum,name}` records plus `enumValue`, `enumFromValue`, `enumMembers`, `enumXml`, `enumFromXml`, `enumString`; do not claim nonexistent proposed direct methods |
| Length numeric protocol | Immutable checked integer-EMU values with named unit accessors; explicit conversions replace implicit numeric coercion |
| XML constructors and part access | Validated owner-bound factories/views and copied part bytes replace dependency XML nodes and ambient package authority |

Neutral model spellings and positional arguments are retained; operation JSON
uses camelCase. Undefined applies only declared defaults; null is admitted only
by the type contract. Strings/booleans/numbers reject coercion. Unit conversion
uses safe finite ranges and nearest-half-away-from-zero rounding. Numeric line
spacing means a multiple; a Length means distance. Caller-owned input bytes remain
unchanged. No external runtime, document-supplied code, implicit network, font
lookup, host clock or host filesystem is added to the product.

## Historical red evidence and resolved findings

The original research snapshot found only utility-level style support. That
snapshot is superseded for this bounded subgraph by the tests above; the global
upstream inventories remain historical research records.

Original regressions preceded implementation fixes for:

- Empty latent containers dropping unknown qualified attributes.
- Imported formatting losing inherited namespace bindings.
- Unrelated paragraph edits invalidating live tab handles.
- Deleted latent handles resurrecting when their names were reused.
- Repeated style lookup reparsing unchanged XML and exhausting retained-byte accounting.
- Missing deprecated ID fallback/warning.
- Absent names being conflated with empty-string keys.
- Applied-style deletion being blocked at publication instead of retaining fallback references.
- Generic enum XML helpers accepting UNMAPPED sentinel strings.

Root/formatting owners fixed these behaviors; audit agents did not bypass limits
or weaken tests to obtain passes. One excessive runtime-class assertion was
removed because the pinned source fixture established only the absent-type
getter. Red/green receipts remain distinct in the map. Plans and agent QA
procedures remain under `docs/plans`; this directory contains evidence only.
