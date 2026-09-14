# DOCX API reconciliation evidence

Reviewed 2026-09-13 against source commit
`e45454602b53e8e572b179ccf1c91093ec9f4ed7`. Research only; no product implementation
or adapted tests. The [inventory](upstream-api-inventory.json) is schema version 2.
The [shared SDK](../specs/office-sdk.md) and [shared CLI](../specs/office-cli.md)
remain authoritative. The next task owns `public-api-map.json`; this review does
not complete that task or any subsequent implementation task.

## Evidence and scope

The review used all 39 hashed pinned API/user RST files, their 59 class/function/
method/attribute directives, source declarations and base classes, guide prose,
and the corresponding published pages. Each published URL and access method is
recorded in `published_review`. The published pages identify version 1.2.0;
that version label does **not** establish that every published source module is
byte-identical to the pinned commit. Source hashes and line references are local
pin evidence; no hash is invented for the browser tool's parsed published pages.
Direct HTTP downloads returned 403. Published pages were read through the web
research tool; neither `objects.inv` nor a new Sphinx build is claimed.

Static AST inspection did not import or execute the reference package, install
dependencies, invoke a native document runtime, or open a document. Network reads
were explicit research requests for the linked published documentation. No corpus
files were changed or deleted. The existing standalone license notice remains
applicable to source-derived research material.

The original 331 IDs remain present. The enriched register has **920 records**:
572 model/inherited records, 335 returned-package-view/owner-protocol records,
five explicitly internal constructor-support records, and eight erroneous
documented symbols. There are **262 nested enum values**, including value aliases,
and **11 enum type aliases**, including the explicitly internal header/footer
constructor enum alias. These are different denominators; do not add them and call
the result an implemented API count. An enum value needs its own disposition in
the next task's API map.

`Sections` was present as `ABCMeta` in the candidate but was not expanded as a
class. It now has its constructor, indexed/sliced access, iteration, length and
inherited sequence operations recorded. Other additions include inherited style
and unit members, returned `_Text`, `Drawing`, `Image`, package/relationship
interfaces, and the two structural owner protocols. `Font` exposed from the run
module retains its documented identity, with its defining module recorded
separately. No underscore-prefixed public type is removed.

Each source-backed member records its defining file and lines. `source_files`
contains the file hashes. `source_contract` preserves argument order, keyword-only
status, defaults and annotations; properties have separate getter and setter
signatures and setter locations. Missing source annotations are explicitly
unannotated, **not** inferred as `any`, `void`, read-only, or unsupported. Direct
`raise` expressions are evidence of local raises, not an exhaustive exception
analysis of callees. Constructors are separate from ordinary members. The dynamic
Python Enum-class factory signature from the first inventory is removed; it was
runtime introspection machinery, not a documented document-model constructor.

`rst_excluded_for_owner` preserves explicit documentation exclusions while keeping
the member available for public-base, prose and returned-interface accounting.
For example, `style_id` is excluded from the style autodoc list but described in
the style-identification guide. A directive exclusion cannot erase that behavior.
Conversely, package loader lifecycle hooks are source support, not evidence that
an unrestricted loader is a required public host capability.

## Source and documentation discrepancies

Paths below are relative to the pinned checkout; their exact member locations and
hashes are also in the inventory. Published links identify the independently read
documentation. Resolutions distinguish documentation errors, source defects and
intentional shared-contract differences. They are research decisions, not fixes
to the reference project or passing TypeScript tests.

| ID  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                       | Resolution for the target                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | [Comment guide](https://python-docx.readthedocs.io/en/latest/user/comments.html) uses `id`/`date`; `src/docx/comments.py` defines `comment_id`/`timestamp`. The guide also prints an obsolete collection module path.                                                                                                                                                                                                          | Retain `comment_id: number` and `timestamp: Date \| null`, both read-only. Do not invent `id`/`date` aliases or copy printed runtime/module identities.                                                                                                                                                         |
| D02 | [Comments API](https://python-docx.readthedocs.io/en/latest/api/comments.html) mentions `comments.paragraphs`; [Document API](https://python-docx.readthedocs.io/en/latest/api/document.html) suggests direct `Comment.add_run`. `Comment` is a block container; `Paragraph` owns `add_run`. `Document.add_comment` annotates `text` as nullable, but `Comments.add_comment` calls `text.split` for any nonempty-string value. | Use `comment.paragraphs[0].add_run` or `comment.add_paragraph().add_run`. No collection `paragraphs` or comment-level `add_run` aliases. Treat `null` comment text as invalid input, with a neutral type error before mutation; omission means `""`. Retain the nullable source annotation as drift evidence.   |
| D03 | [Table direction enum example](https://python-docx.readthedocs.io/en/latest/api/enum/WdTableDirection.html) assigns `Table.direction`; `src/docx/table.py` defines `table_direction`.                                                                                                                                                                                                                                          | Retain `table_direction`, including read/write null/inheritance semantics. `direction` is a documentation error, not an additional API.                                                                                                                                                                         |
| D04 | [Theme enum page](https://python-docx.readthedocs.io/en/latest/api/enum/MsoThemeColorIndex.html) lists `MIXED`; `src/docx/enum/dml.py` has no such member. `WD_UNDERLINE.INHERITED` exists in source but is absent from its static page. `WD_BREAK_TYPE.TEXT_WRAPPING` and `LINE_CLEAR_ALL` both have value 11.                                                                                                                | Keep a visible documentation-error row for `MIXED`; invent no number. Retain source `INHERITED` and the break value alias, with all enum values and XML mappings. Enum membership alone does not mean every setter accepts every value.                                                                         |
| D05 | [Style guide](https://python-docx.readthedocs.io/en/latest/user/styles-using.html) spells `priorty`, refers to `BaseStyle.base_style`, and prints obsolete `_ParagraphStyle`/`LatentStyle` class names. `src/docx/styles/style.py` defines `priority`, and defines `base_style` on `CharacterStyle`, inherited by paragraph/table styles.                                                                                      | Use the actual spellings and inheritance. Do not promise `base_style` on `BaseStyle` or `_NumberingStyle`. Returned paragraph and latent style types are `ParagraphStyle` and `_LatentStyle`; printed representations do not introduce aliases.                                                                 |
| D06 | [Built-in style enum example](https://python-docx.readthedocs.io/en/latest/api/enum/WdBuiltinStyle.html) indexes by enum; [style-type example](https://python-docx.readthedocs.io/en/latest/api/enum/WdStyleType.html) indexes by `0`. `Styles.__getitem__` in `src/docx/styles/styles.py` accepts string names, with deprecated ID fallback.                                                                                  | Styles are keyed by names, not ordinal positions or enum numbers. Preserve the enum itself. Use iteration for ordinal selection and a name for lookup; report the ID fallback's deprecation without introducing an integer lookup overload.                                                                     |
| D07 | [Quickstart](https://python-docx.readthedocs.io/en/latest/user/quickstart.html) removes spaces from table style names, uses `ListBullet`, and reads tuple records with attribute syntax. `Table.style` documents retaining spaces and removing the UI hyphen; `Styles.__getitem__` warns on ID fallback.                                                                                                                       | Use actual English built-in names (`List Bullet`, `Light Shading Accent 1`) or exact custom names. Compact IDs are legacy lookup behavior, not the name algorithm. Original examples must destructure tuples or use explicitly authored object records.                                                         |
| D08 | [Style explanation](https://python-docx.readthedocs.io/en/latest/user/styles-understanding.html) says absent styles never raise. `Styles.__getitem__` raises `KeyError`; `get_style_id` reaches this lookup.                                                                                                                                                                                                                   | Separate reading an existing dangling style reference, which can use a default style, from assigning an unknown name, which fails. `BaseStyle.delete` removes the definition, not the styled content. Do not silently accept misspelled style assignments.                                                      |
| D09 | [Document guide](https://python-docx.readthedocs.io/en/latest/user/documents.html) says headers cannot be edited, suggests text `StringIO` for binary input, and promises broad load/save preservation. `section.py` has editable headers/footers and `api.py` consumes a binary package.                                                                                                                                      | Headers/footers are in scope. Inputs/outputs are byte capabilities. Broad historical wording does not override bounded admission, supported-profile checks, or preservation requirements. Network/database acquisition is caller-owned.                                                                         |
| D10 | [Core-properties docs](https://python-docx.readthedocs.io/en/latest/api/document.html) describe naive UTC dates and refer to a presentation. `src/docx/oxml/coreprops.py::_parse_W3CDTF_to_datetime` returns timezone-aware UTC; the setter formats supplied wall time with `Z` without offset conversion.                                                                                                                     | Use UTC `Date` values and normalize instants before whole-second serialization. Preserve missing/invalid source date read behavior as null, with diagnostics where required by validation. Reject invalid assigned dates. Do not copy the source offset-labeling defect. The container is a document.           |
| D11 | [Run traversal docs](https://python-docx.readthedocs.io/en/latest/api/text.html) say `Drawing` only exposes `_drawing`. Pinned `src/docx/drawing/__init__.py` also defines `has_picture` and `image`; `image` returns `Image`.                                                                                                                                                                                                 | Retain all three in the returned-interface inventory. Map `_drawing` to a bounded XML view; it is explicitly described despite its underscore. Include all `Image` metadata, admission helpers and dimension calculation.                                                                                       |
| D12 | `Drawing.has_picture` says linked pictures return false, but its XPath checks for `pic:pic`, without requiring `r:embed`. `Drawing.image` does require an embedded relationship.                                                                                                                                                                                                                                               | Record the source defect. The target's advertised embedded-picture predicate must require an admitted embedded relationship; linked-only images return false and `.image` fails with a neutral unsupported/missing embedded-content error. Never fetch a linked target.                                         |
| D13 | `src/docx/parts/image.py::ImagePart.default_cy` documents vertical DPI but divides by horizontal DPI. `src/docx/image/image.py::Image.height` uses vertical DPI.                                                                                                                                                                                                                                                               | Use vertical DPI for native height consistently; preserve an explicit source-defect disposition. An original unequal-horizontal/vertical-DPI case is required in the owning image task.                                                                                                                         |
| D14 | [Run text API](https://python-docx.readthedocs.io/en/latest/api/text.html) describes writing `w:cr` for newlines. `src/docx/oxml/text/run.py::_RunContentAppender.add_char` writes `w:br`.                                                                                                                                                                                                                                     | Both read as a line break; canonical newly written output uses `w:br`. Preserve existing unmodified XML. Run text assignment retains run formatting; paragraph text assignment replaces runs and removes run formatting. Neither is formatting-preserving literal replacement.                                  |
| D15 | `src/docx/shared.py` unit constructors truncate fractions; `Length.twips` and `Image.scaled_dimensions` use Python ties-to-even rounding. Shared CLI section 4 requires nearest, halfway away from zero.                                                                                                                                                                                                                       | Shared rounding wins for the target SDK and CLI. Explicitly disclose the numeric compatibility difference; never claim exact Python numeric parity. Validate safe finite values before and after conversion.                                                                                                    |
| D16 | [Installation guide](https://python-docx.readthedocs.io/en/latest/user/install.html) lists Python 2.6–3.4 and old install mechanisms. Pinned `pyproject.toml` requires Python >=3.9 and lxml >=3.1.0.                                                                                                                                                                                                                          | Historical installation prose does not describe the pinned baseline. Neither Python nor lxml is a product runtime dependency. No native installation is part of this task.                                                                                                                                      |
| D17 | [Section guide](https://python-docx.readthedocs.io/en/latest/user/sections.html) describes eleven properties and prints three sections immediately after blank creation; the source exposes more properties and traversal.                                                                                                                                                                                                     | Inventory source members and all six header/footer variants; do not use an example count as a surface limit or a default-template assertion. Page orientation does not itself swap page dimensions.                                                                                                             |
| D18 | [Color API introduction](https://python-docx.readthedocs.io/en/latest/api/dml.html) mentions luminance adjustments, but `ColorFormat` exposes only `rgb`, `theme_color`, and `type`.                                                                                                                                                                                                                                           | Do not invent a `brightness`/luminance setter. Preserve unknown color transforms under the format contract; introductory prose alone does not name an implemented luminance API.                                                                                                                                |
| D19 | [Shape guide](https://python-docx.readthedocs.io/en/latest/user/shapes.html) juxtaposes inline-only support and a statement that floating pictures can be added. `Document.add_picture` / `Run.add_picture` create inline shapes.                                                                                                                                                                                              | These methods insert inline pictures. Existing floating picture inspection through `Drawing` is distinct. Format-spec floating editing remains additive future work; do not advertise it as an existing upstream constructor.                                                                                   |
| D20 | `RGBColor.from_string` splits two characters for red/green and the remaining suffix for blue, so some non-six-character strings can parse. Public docs show six hex digits; the shared SDK requires validated channel/hex semantics.                                                                                                                                                                                           | Target input is exactly six ASCII hex digits, case-insensitive; output is six uppercase digits. Reject whitespace, signs, prefixes, nonhex and wrong lengths. This is explicit validation tightening, not an inherited permissive parser promise.                                                               |
| D21 | `CoreProperties` source setters coerce nonstrings; revision reads can yield zero but writes require positive integers. The SDK requires typed values and coercion rejection.                                                                                                                                                                                                                                                   | String assignments require strings; length counts Unicode code points, matching the source's 255-character bound. Revision reads retain zero for absent/invalid source values; setters require positive safe integers. Nullable reads do not imply nullable setters. Removal uses the typed property operation. |
| D22 | The style-use guide calls all four visibility/locking/gallery flags tri-state. `src/docx/styles/style.py` delegates to `src/docx/oxml/styles.py`, whose missing `semiHidden`, `locked`, `qFormat` and `unhideWhenUsed` children read as false. `_LatentStyle` instead retains nullable override values.                                                                                                                        | Defined-style `hidden`, `locked`, `quick_style`, and `unhide_when_used` read boolean; assigning null removes the explicit child and subsequently reads false. Latent-style overrides retain boolean-or-null reads. Do not reuse one tri-state getter contract for both classes.                                 |
| D23 | `TabStop.position` in `src/docx/text/tabstops.py` replaces `_tab` but leaves inherited `_element` pointing at the detached node; `ElementProxy.element` in `src/docx/shared.py` returns that older element.                                                                                                                                                                                                                    | Record the source handle/view inconsistency. The target tab handle follows its replacement node; `.element` must expose the current owned node, and previously issued detached node views must fail as stale. Do not copy a silent split between the position getter and XML view.                              |

These resolutions also cover stale RST exclusions such as `InlineShapes.add_picture`
and `Document.styles_part`: neither exists on the pinned class. Their exclusion
directives are retained as evidence, not converted into imaginary members.
`WD_HEADER_FOOTER_INDEX` explicitly declares itself internal in its source
docstring; it is retained as constructor support because public header/footer
constructor signatures reference it, rather than hidden by naming convention.

## Prose and returned-interface coverage

All user-guide topics are accounted for independently of source tests:

| Guide                | Public behavior retained / disposition                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API concepts         | Async document factory followed by synchronous block creation; return live content handles. The guide's factory/object terminology does not introduce a second document class.                                                      |
| Quickstart           | Paragraph insertion before a cursor; headings including level 0; page breaks; row/column/cell traversal and growth; image native/explicit sizing; paragraph/character/table styles; run formatting. D07 resolves obsolete examples. |
| Documents            | Original empty template, supplied template, byte-source load and byte-sink save, explicit VFS publication; D09 resolves stale runtime and preservation wording.                                                                     |
| Tables               | Omitted leading/trailing grid slots, repeated merged-cell views, row/column iteration, nested tables and paragraph/table order. Omitted cells never become fabricated `_Cell` objects.                                              |
| Text                 | Alignment, negative indents, tab stops and leaders, collapsed spacing, length versus line-multiple spacing, pagination flags, tri-state font flags, hybrid underline enum/boolean, RGB/theme/null semantics.                        |
| Sections             | Sequence indexing including negatives/slices, traversal, section creation, page dimensions/orientation and margins, all header/footer variants. D17 rejects example-count assumptions.                                              |
| Headers/footers      | Getter-created definitions, recursive inheritance, unlink/relink deletion and shared-story edits; required empty paragraph and tabbed content. Merely reading `header.paragraphs` may create a definition.                          |
| Understanding styles | Name/ID/type identification, built-in versus custom/latent definitions, inheritance, five UI behavior fields, original default style assets. D05/D08 resolve incorrect member ownership and missing-style promises.                 |
| Using styles         | Keyed lookup/iteration, assignment by name or owned object, create/delete, formatting, next paragraph style, visibility/priority/locking, latent defaults/create/delete.                                                            |
| Comments             | Nonempty anchored run range, rich paragraphs/tables/images, ID lookup, author/initials metadata, supplied UTC time, no nested/header/footer anchors. No comment-thread implementation is inferred.                                  |
| Shapes               | Inline insertion versus floating content inspection; no renderer or layout engine. Returned `Drawing.image` reaches bounded raster characterization and SHA-1 compatibility metadata.                                               |
| Install              | Research provenance only; not a model operation or permission to add a runtime. D16 records the mismatch.                                                                                                                           |

The returned graph closes at typed model/value collections or bounded XML/package
views. `_Text` is a returned handle with no public source methods, not a string
setter accidentally invented from its name. `Run.element` is an assigned source
attribute; its identity is read-only in the target, with mutation through the
validated view. `Drawing._drawing` follows the same rule. `Document.part` reaches
parts, relationships, content types, part names, core properties and image data;
the inventory records their source-visible signatures and ownership protocols.

The XML boundary does not recursively promise every lxml method, generated XML
descriptor, Python `int`/`str` method, loader class registry, or arbitrary XPath.
XML element tag/namespace, attributes, ordered children, text/tail and bounded
serialization/validated mutation map to an owned `XmlElementView`; part views
expose names/content types/bytes and scoped relationship lookup/mutation. Package
load/save remain the factory/publication capabilities. Internal marshal hooks do
not run user callbacks. A source method requiring these internals must receive an
explicit observable replacement or unsupported disposition in the later API map,
never a passing parity label solely because this research collected its name.

## Language and security decisions

These are precise shared-contract mappings and reconciliation inputs. Type names
below describe proposed capabilities, not verified package exports. The later
API-map task must assign every member its concrete TS signature, route and
original acceptance cases without changing these shared decisions implicitly.

| Boundary          | Target mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Factory           | `Document(input?: Uint8Array \| ByteSource \| VfsPath \| null, context?: DocumentContext): Promise<DocumentModel>`; omission/null selects an original authored template. A path requires an explicit VFS capability; never ambient `fs`.                                                                                                                                                                                                                                         |
| Publication       | `document.save(output: ByteSink \| VfsPath): Promise<void>` using the document's admitted context. Always async, including in-memory sinks. Paths obey shared output/in-place/force and atomic-publication rules.                                                                                                                                                                                                                                                                |
| Image input       | `document.add_picture(input: Uint8Array \| ByteSource \| VfsPath, width?: number \| Length \| null, height?: number \| Length \| null): Promise<InlineShape>`; same signature on `Run`. `Image.from_blob` and `Image.from_file` are always async admission. Owned admitted-image properties and `scaled_dimensions` stay synchronous.                                                                                                                                            |
| Options           | Preserve positional order and neutral snake_case model names. Source keyword-only parameters become trailing typed source-spelled options. No blanket camelCase alias layer; operation JSON uses camelCase separately. Omission/undefined applies the documented default; null applies only when the specific setter/parameter allows it.                                                                                                                                        |
| Sequences         | Zero-based numeric lookup and `.length`; `Symbol.iterator`; `.at(index)` supports negative indices. `Sections` and `_Rows` support `.slice(start, end)`; snapshot arrays support ordinary slicing. `_Columns`, `InlineShapes` and `TabStops` do not gain source slicing merely because their implementation indexes an internal list. Bounds errors remain observable rather than JS undefined.                                                                                  |
| Keyed collections | `Styles` and `LatentStyles` resolve string names, not integer indexes. `Comments.get(comment_id: number): Comment \| null` is ID lookup, not sequence lookup. Relationships are keyed by owner-scoped rId, with bounded get/set/delete/iteration; dictionary protocol mappings are enumerated in the inventory.                                                                                                                                                                  |
| Protocols         | `__len__` → readonly `.length`; `__iter__` → `[Symbol.iterator]()`; sequence `__getitem__` → numeric lookup/`.at`, supported slice → `.slice`; `TabStops.__delitem__` → `remove(index: number): void`; `__contains__` → keyed `.has` or sequence `.includes`; model `__eq__`/`__ne__` → owner-and-node `.equals(other)` / its negation, not wrapper allocation identity.                                                                                                         |
| Values            | `str` → string, `bool` → boolean, `int` → validated safe integer, numeric real → finite number, `None` → null where allowed. Tri-state flags remain `boolean \| null`. Underline additionally accepts the typed enum and reads single/none as true/false. Numbers never silently stand for Length in line-spacing union dispatch.                                                                                                                                                |
| Units             | Immutable `Length`, `Emu`, `Inches`, `Cm`, `Mm`, `Pt`, `Twips`; integer EMU storage with 914400/in, 360000/cm, 36000/mm, 12700/pt, 635/twip. Shared nearest/half-away rounding, safe bounds, negative values only where the property allows them. Arithmetic uses explicit `.emu` and validated rewrapping, not arbitrary-precision Python inheritance. No DOCX centipoint constructor is invented.                                                                              |
| Enums/colors      | Retain every listed numeric value, documented type alias and value alias. Typed lookup rejects unknown values. `from_xml`/`to_xml` retain neutral spelling with explicit failure for unmapped XML/value representations; no dynamic Enum class construction. `RGBColor(r,g,b)` accepts integer channels 0–255; `from_string` follows D20; immutable tuple iteration/lookup maps to explicit JS sequence operations.                                                              |
| Bytes/images      | Owned or copied `Uint8Array`, immutable admitted metadata, no caller-buffer mutation races. PNG/JPEG (JFIF/Exif), GIF87a/89a, BMP and both-endian TIFF match the pinned signature families; bounded parsers, no native decoding. Use per-axis DPI or 72 fallback, one explicit dimension preserves aspect ratio, two set both extents. SHA-1 stays compatibility metadata; identity/evidence use SHA-256.                                                                        |
| Dates/identity    | UTC `Date`, invalid assignment rejection and whole-second XML precision (discard milliseconds after UTC normalization). Context supplies time for comments and default core-property creation; no ambient clock/identity. Author/initials defaults remain empty strings; null initials removes the attribute. Default metadata/template bytes are original and neutral.                                                                                                          |
| Ownership         | Live model objects share owning document identity. Snapshot lists hold live handles; list mutations do not rewrite the document. Merged grid positions may identify the same logical cell. Cross-document assignment requires explicit import. Destructive replacement invalidates removed handles deterministically. `TabStop.position` reorders its underlying node while preserving the selected tab handle; stale sibling node views must fail.                              |
| Errors            | Source TypeError → neutral input-type error; ValueError → invalid-value or semantic-validation error; IndexError → bounds error; KeyError → missing-key error, except documented nullable lookups remain null. Use stable shared codes (`usage`, `missing-selection`, `invalid-package`, `unsupported-edit`, `limit-exceeded`, `permission`, `source-failure`, `sink-failure`, etc.) according to operation context. Never expose source-branded classes or raw source messages. |
| Authority         | `.element`/`.part` and returned graph objects carry their owner and granted capabilities; no host paths, external relationship dereference, host fonts, arbitrary eval/property invocation, or native runtime. Read-only CLI operations use noncreating queries rather than getters that create comments, properties, settings, styles or header definitions.                                                                                                                    |

Model `.text` setters and `.clear()` retain their documented destructive scope.
CLI `text replace` is the distinct format-preserving literal operation. Common
commands use plural `images`, `tables`, `properties`, and the shared flags,
selectors, JSON and error envelope. CLI display positions are one-based and
scoped; emitted locations are fingerprinted, and stale/ambiguous selection fails.
The operation registry/schema/capabilities must eventually expose each supported
behavior directly or via validated typed batch operations; this task creates no
unreviewed command-name inventory.

Ordinary CLI exits remain 0 success, 1 document/selection/validation, 2 usage/schema,
3 I/O/publication, 4 resource limit, 130 cancellation. Diff uses 0 equal, 1 different,
2 failure, 130 cancellation; differences remain successful result data. The version
1 envelope remains `version`, `operation`, `ok`, `data`, `warnings`, `errors`,
`affected`, `locations`. No alternate per-format convention is introduced.

## Validation and remaining gates

Before editing, an independent presence assertion failed for `Drawing.image`,
`WD_ORIENT`, `Inches.twips`, and returned `_Text`. That is concrete inventory
defect evidence, not a product regression test. This documentation-only task does
not write product code, unit tests, or screenshot tests. The agent review procedure
and final check results are in [the owned task record](../plans/docx-public-api-reconciliation.md).

The source-test inventory was parsed in full: 1,609 unit variants and 650 expanded
BDD cases, all still `unmapped_not_implemented`. The test audit's historical
passes are unchanged and were not rerun. This review never used absence from
those tests as an API exclusion. Source defects above require original small
memfs cases before product fixes in their owning tasks; no downloaded binary
becomes a permanent fixture.

The expanded count is **not an exhaustive certificate**. Review closure is over
the named pinned documents and the explicitly recorded returned/built-in protocol
boundaries. New source/docs evidence must add or correct rows. Detailed target
signatures, transitive errors, feature-to-command coverage, original test
adaptation, product behavior, screenshots and corpus cleanup remain later tasks.
No `implemented` disposition or parity claim is justified by this inventory.
