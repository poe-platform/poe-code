# Original in-memory DOCX fixture coverage

Status: fixture preparation verified; product behavior remains pending.

The test-only builder is `packages/docx/tests/fixtures/documents.ts`; its 23
checks are in the adjacent `documents.test.ts`. Each call returns fresh owned
`Uint8Array` archive bytes and a part map. Fixed UTC archive dates, sorted member
names, fixed content and explicit limits keep archives deterministic and under
32 KiB. No binary files are stored in the repository. The four themes use original
wording: garden handbook, observatory log, museum catalog and multilingual tools.

`valid` selects the ordinary Transitional document; `strict`, `template` and
`empty` are explicit positive variants. `missing-target` removes the styles part
while retaining its edge/declaration; `malformed-xml` leaves an unclosed document;
`invalid-grid` sets the museum's span to zero; `truncated-image` truncates the
museum's BMP. The latter two variants reject themes other than the museum. Each negative variant
changes exactly one part relative to its positive counterpart. Well-formedness
and relationship checks are limited fixture checks, not full schema certification.

## F01–F50 register

“Input” means actual authored fixture data, not a passing editor operation.
“Pending” names missing evidence explicitly; every feature's product acceptance
remains pending even when an input exists. No downloaded body is used.

| ID | Input / fixture evidence | Pending subfeatures and behavior |
| --- | --- | --- |
| F01 | All: shared-codec ZIP, decoded payload equality, fixed metadata | Independent stored/deflate controls, ZIP64, malicious container variants; product admission |
| F02 | Garden strict/transitional namespace variant | Full dialect schema checks and preservation edits |
| F03 | Garden template content type | Macro-enabled rejection, kind conversion guards |
| F04 | Equipment comments, PI, extension attributes, combining text | Loss-preserving editor and prefix/attribute-order variants |
| F05 | Equipment ignorable extension, Choice and Fallback | MustUnderstand, ProcessContent, admission/branch selection |
| F06 | All part/type/edge inventories; core properties | Product inventory and signature/protection reporting |
| F07 | Original XML bytes; malformed-xml variant | Validated XML replacement and bounded display |
| F08 | Garden split runs; observatory stories; equipment tabs/breaks | Product extraction, locations and complete scope ordering |
| F09 | Equipment Arabic, Japanese, combining accent, astral tool | Cross-run Unicode replacement, complete language/font metadata |
| F10 | Garden adjacent formatted runs spelling one sentence | First/all/occurrence, barrier and stale selection acceptance |
| F11 | Garden empty variant with required paragraph/section | Public creation and structured-content validation |
| F12 | Garden bold true/false/absent; equipment RTL/language | Remaining font flags, color/theme, underline and unit boundaries |
| F13 | Garden keepNext, spacing and zero indentation | Tabs/leaders, borders, shading, pagination and spacing types |
| F14 | Original Normal/Title/Heading1 with inheritance | Latent/linked/table styles, theme parts and cycles |
| F15 | Garden Title style; Heading1 definition | Actual heading paragraphs 1–9, collision behavior |
| F16 | Observatory two sections; page size/margins | Columns, orientation transitions, all section break variants |
| F17 | Observatory explicit first section bindings, inherited second | First/even stories, unlink/relink and clone/shared edits |
| F18 | Garden levels 0/1, abstract 2, concrete 7, start override 3 | Bullets, style links, picture bullets, restart isolation |
| F19 | Museum nested table, empty terminal paragraphs | Row/column growth, widths, formatting and removals |
| F20 | Museum horizontal span, vertical continuation, omitted slot; zero-span invalid variant | Merge/split operations, trailing omission and nonrectangular rejection |
| F21 | Equipment bookmark and inert external link; observatory REF bookmark | Unsafe schemes, fragment-only links, rename/removal policy |
| F22 | Garden simple PAGE cache; observatory complex REF begin/separate/end | Nested fields, unsupported instructions, result editing |
| F23 | REF input offers a reference boundary | TOC and caption creation/cache graphs |
| F24 | Observatory foot/endnotes, separators and ID 2 references | Note insertion/removal and scoped allocation |
| F25 | Observatory ID 4 rich comment, table, explicit UTC author/time and anchor | Illegal anchor variants, modern metadata, nullable ID lookup |
| F26 | Equipment insertion/deletion with distinct IDs and original wording | Read views and accept/reject behavior |
| F27 | None | Move/table/section review and threaded preservation inputs |
| F28 | Equipment tagged plain-text control | Locks, checkbox, choice, date, rich/picture controls |
| F29 | None | Repeating/data-bound control inputs and synchronization |
| F30 | Core title, positive revision, explicit UTC creation | Extended/custom types, null reads, invalid dates and 255/256 scalars |
| F31 | Museum two inline occurrences share one relationship/media payload | Floating/linked-only images, crop, rotation and inventory |
| F32 | Complete authored BMP with 2×1 pixels, unequal per-axis density; truncated variant | PNG/JPEG/GIF/TIFF and invalid offsets/DPI; insertion sizing |
| F33 | None | Anchors/wrapping/z-order and geometry edit inputs |
| F34 | Museum original BMP bytes retained exactly | Other inert formats and fallback resources |
| F35 | None | Supplied/admitted SVG plus fallback and unsafe references |
| F36 | None | Text-box stories, VML and grouped geometry |
| F37 | None | Chart cache/workbook graph and preservation |
| F38 | None | Diagram data/layout graph and preservation |
| F39 | None | Bounded OMML inputs and invalid fragments |
| F40 | None | Inert embedded objects and extraction |
| F41 | Museum original custom XML part/relationship and opaque annotation | Glossary, bindings and ancillary graph variants |
| F42 | None | Settings, fonts, protection refusal inputs |
| F43 | None | Signature graph, refusal and explicit strip inputs |
| F44 | Museum empty cells, shared image references; observatory annotations | Actual removal/reference checks and required-node retention |
| F45 | Garden visible text supplies replacement input | Seed/cardinality and deterministic vocabulary acceptance |
| F46 | Equipment link/revisions; observatory comments; core properties | Enumerated sanitization reports and publication atomicity |
| F47 | Tagged equipment control and garden template input | Typed batches, data expansion and rollback |
| F48 | Fresh byte-identical copies; isolated one-part invalid variants | Semantically equal alternate serialization and product diff |
| F49 | XML parsing, target/type checks; named malformed/graph/grid/media variants | Independent reusable assertions, schema/profile diagnostics |
| F50 | All archive members decoded to equal part bytes; memfs input/output isolation | VFS extract/pack inventories, traversal/alias and hash refusal |

## Behavioral adaptation and language/security mapping

The research [test crosswalk](test-case-map.json) keeps every original source-case
identity and exact parameters. Its owning feature tasks still own failing product
tests. This fixture task contributes reusable data for those tasks; it does not
claim the many source variants are covered by these 23 preparation checks.

| Research boundary | Authored input | Required JS behavior, still pending |
| --- | --- | --- |
| Run state and setters | Garden true/false/absent bold and split sentence | `boolean \| null`, omission/undefined defaults; `.text` replacement differs from preserving `text.replace` |
| Collections and ownership | Museum horizontal/vertical logical slots and nested blocks | `.length`, iteration, zero-based indexing; supported `.at`/`.slice`; owner/node equality; omitted slots are not empty cells |
| Story definitions | Observatory inherited header/footer | Live model getter side effects retained; read-only CLI uses noncreating queries; one-based CLI ordinals differ from model indexes |
| Comments | ID 4, author Mira, fixed date and rich blocks | `comment_id` and `timestamp`, absent `Comments.get` returns null; no `id`/`date` aliases; explicit time context |
| Image characterization | Two pixels, horizontal 3780 and vertical 7560 pixels/metre | Owned `Uint8Array`; always-async input; native per-axis DPI, independent 72-DPI fallback; safe EMU rounding halfway away from zero |
| Package/element views | Part map, scoped relationship IDs, extension markup | Bounded owner-bound views; no arbitrary XPath, runtime dispatch or host authority |
| Text and properties | Arabic/Japanese/combining/astral strings, UTC core date | Logical Unicode scalars; copied UTC dates; no coercion; nullable read is not nullable write |
| API/CLI contract | No public engine introduced | Neutral snake_case model spellings; camelCase operation options; plural `images/tables/properties`, `text replace`, closed schema/capabilities and common statuses |

The [API register](public-api-map.json) remains authoritative for all 1,337
member/value/protocol rows, including inherited members, enum aliases, helpers,
returned interfaces and documented underscore-prefixed public types. None are
reclassified as private. Its exact neutral error mappings remain: input type to
TypeError-derived input errors, value to RangeError-derived validation errors,
sequence/key to bounds/missing-key, ownership/stale handles to their typed errors,
I/O to capability-scoped errors; nullable lookup stays null. Async factories/save
and synchronous admitted model access are unchanged.

Documentation drift already resolved in the [reconciliation](upstream-api-reconciliation.md)
is retained: comments use `comment_id/timestamp`, model tables use
`table_direction`, relationships use `get/items/at`, whole-text setters retain
their destructive scope, per-axis image DPI is independent, and UTC values are
normalized before whole-second serialization. No new discrepancy was found in
this fixture task. Tests do not implement compatibility aliases or reference APIs.

The [owned task record](../plans/docx-original-unit-fixtures.md) contains red/green
commands and scope. The standalone notice at
`packages/docx/THIRD_PARTY_NOTICES.txt` retains attribution separately from tests.
