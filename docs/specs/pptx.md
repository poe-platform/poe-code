# PPTX Utility Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Define an original TypeScript `pptx` utility for creating, reading and
editing presentations through a typed SDK and an explicit safe-bash command.

## Normative Language

MUST and MUST NOT identify conformance requirements. SHOULD identifies a strong
recommendation whose exceptions need evidence. MAY identifies optional behavior.
All product behavior below is proposed, not a statement of implemented support.

## 1. Problem Statement

Agents need to manipulate real presentations without losing slide appearance,
speaker notes, media, interactions or content that the editor does not understand.
A ZIP file that opens is insufficient evidence of a correct edit. The contract
must distinguish reading, editing, preservation, validation and rendering.

The utility name MUST be exactly `pptx`. CLI and SDK MUST share operation semantics,
limits, selectors, results and errors. Tests and examples MUST use original content.
Reference-project identities and attributions MUST NOT appear in product code,
code comments, identifiers, test names, fixtures or CLI output. Crosslinks belong
in plans/research; required attribution for substantial derived material belongs
in standalone legal notices.

## 2. Goals and Non-Goals

The supported product creates new presentations and populates templates; reads
slide content, notes, properties, structure and resources; and edits supported
structures while preserving unrelated content. Image operations are first-class.
Slide copying and merging MUST transfer the relationship graph, not only slide XML.
Support includes macro-free `.pptx`, `.potx` and `.ppsx` with explicit output kinds.

This is not a PowerPoint replacement, a font shaping/layout engine, a video player,
a macro executor, a spreadsheet calculation engine or an automatic design service.
Bounded text fitting with explicitly supplied font metrics is supported; it is
not a whole-slide rendering or font-discovery engine.
The runtime MUST NOT spawn PowerPoint, LibreOffice, Python, native converters or
other host processes. It MUST NOT fetch external links or silently rasterize slides.
Legacy binary `.ppt`, ODP conversion, encryption/decryption and universal Office
extension editing are outside this contract. Independent renderers are QA tools,
not hidden product dependencies. PDF, PNG and video export are not core promises.

## 3. Standards and Evidence Boundary

The standards register MUST pin actual documents and map namespace/schema types
and normative clauses to supported behavior, instead of claiming full OOXML support.

| Source          | Baseline                     | Scope                                                                             |
| --------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| ECMA-376 Part 1 | Fifth edition, December 2016 | PresentationML, DrawingML, themes, charts, shared markup and mathematical content |
| ECMA-376 Part 2 | Fifth edition, December 2021 | Open Packaging Conventions, relationships, content types and signatures           |
| ECMA-376 Part 3 | Fifth edition, December 2015 | Markup Compatibility and Extensibility                                            |
| ECMA-376 Part 4 | Fifth edition, December 2016 | Transitional migration features, including legacy markup                          |

These editions are listed by [Ecma](https://ecma-international.org/publications-and-standards/standards/ecma-376/).
The implementation MUST track [MS-PPTX extensions](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/efd8bb2d-d888-4e2e-af25-cad476730c9f)
separately from the base standard. That source currently lists revision 25.0,
August 20, 2024; implementation research MUST record the retrieved revision and
any newer schema dependencies. DrawingML extensions, modern comments, SVG, media
and chart extensions need their own namespace/revision entries. No invented clause
numbers or assumption that every Microsoft extension belongs to MS-PPTX is allowed.

Microsoft's [PresentationML structure documentation](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)
is useful secondary guidance within the vendor's documentation; the standards and
schemas govern normative format claims. The [Office format reference](https://learn.microsoft.com/en-us/office/compatibility/office-file-format-reference)
distinguishes presentations, templates, shows and macro-enabled formats.

## 4. System Boundary and Domain Model

The engine accepts bytes, typed operations and explicit capabilities. An adapter
maps these to safe-bash streams and the configured virtual filesystem. The root
package only wires public APIs. Product behavior MUST NOT depend on ambient host
paths, credentials, environment, network, wall clock or randomness.

A presentation is an OPC graph with an ordered slide list, slides, layouts,
masters, notes, themes, relationships and shared resources. A part URI is not a
host path. A relationship ID is local to its source part. A slide ID is distinct
from its position and filename. A shape ID is local to its owning drawing tree;
it is not globally unique across a deck. Placeholder type/index and inheritance
are distinct from shape ID. Group transforms use nested coordinate spaces.

Selectors MUST include presentation fingerprint, owning slide/part and object ID
or a structural path. CLI positions are one-based; JSON selectors MUST name their
coordinate system explicitly. Ambiguous names MUST fail unless an explicit all
selection is supplied. Default scope is slide-local content; notes, layouts,
masters and shared resources require explicit scope. A stale fingerprint fails
before mutation. No arbitrary JavaScript, XPath execution or regex XML editing.

## 5. Feature Coverage Contract

`Edit` below includes read and preserve. `Preserve` means inventory where possible
and lossless retention on unrelated edits; it does not promise semantic editing.
Every family MUST have an exact supported subset and independent evidence in the
coverage register. Unknown subfeatures MUST NOT disappear during serialization.

| ID  | Family                    | Required behavior and boundary                                                                                                                                                                                                          |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | ZIP                       | Bounded stored/deflated read/write, CRC, data descriptors and ZIP64 read within limits; reject encrypted/multi-disk/unsafe archives                                                                                                     |
| F02 | OPC                       | Read/edit content types, internal/external relationships, canonical part identity, reachability and safe graph mutation                                                                                                                 |
| F03 | Dialects/kinds            | Read/edit Strict and Transitional without silent conversion; create macro-free presentation/template/show with correct content type                                                                                                     |
| F04 | XML/MCE                   | Namespace-aware preservation of unknown attributes/subtrees, order and whitespace; correct AlternateContent branch selection and retained fallbacks                                                                                     |
| F05 | Inspection                | Deck, slide, part, relationship, feature and unsupported-feature inventory; raw XML and stable JSON                                                                                                                                     |
| F06 | Creation                  | Original minimal valid deck, explicit size, authored themes/layouts and structured slide input; populate supplied template                                                                                                              |
| F07 | Slide lifecycle           | Add, duplicate, remove, reorder, hide/show and rename; preserve IDs on unaffected slides and maintain references                                                                                                                        |
| F08 | Merge/split/import        | Copy selected slides with dependency closure, notes and resources; deterministic collision remapping and explicit source-theme policy                                                                                                   |
| F09 | Sections/custom shows     | Inspect/edit names, order and membership; handle deleted slides and extension IDs consistently                                                                                                                                          |
| F10 | Presentation settings     | Size/orientation, slideshow options, view/grid settings and slide-number start; preserve unsupported settings                                                                                                                           |
| F11 | Slide masters             | Inspect/create/edit supported master content; explicit shared scope and affected-slide reporting                                                                                                                                        |
| F12 | Layouts/placeholders      | Inspect/create/apply layouts; resolve placeholders by type/index and preserve local overrides; reject ambiguous mapping                                                                                                                 |
| F13 | Themes/inheritance        | Colors, fonts, styles, theme overrides, color maps and effective-value provenance; no destructive flattening                                                                                                                            |
| F14 | Backgrounds               | Solid, gradient and picture backgrounds, explicit slide/layout/master scope; preserve unsupported effects                                                                                                                               |
| F15 | Text reading              | Slide and notes text, paragraphs/runs/breaks/fields, explicit scope and deterministic structural order; no claim of visual reading order                                                                                                |
| F16 | Text editing              | Unicode-safe cross-run literal find/replace; preserve unaffected formatting and hyperlinks; explicit first/all match behavior                                                                                                           |
| F17 | Text styling              | Typeface, size, language, bold/italic, underline/strike, baseline, capitalization, spacing, color and run highlighting                                                                                                                  |
| F18 | Paragraphs/lists          | Alignment, spacing, margins, indent levels, bullets/numbering, tabs and text direction                                                                                                                                                  |
| F19 | Text frames               | Insets, vertical alignment, columns, wrap, autofit settings and rotation; bounded best-fit sizing with explicit supplied metrics, no ambient font discovery                                                                             |
| F20 | International text        | Unicode, combining marks, emoji, RTL, CJK, vertical text and font fallback metadata; preserve complex-script attributes                                                                                                                 |
| F21 | Fields                    | Slide number/date/footer/header fields and cached text with explicit update policy; no implicit date or PowerPoint evaluation                                                                                                           |
| F22 | Shapes                    | Create/edit text boxes and documented preset geometry; names, IDs, fill/line/effects, locks and alt text                                                                                                                                |
| F23 | Custom geometry           | Inspect/preserve arbitrary path geometry; create/edit a documented bounded path subset; reject unsupported formulas                                                                                                                     |
| F24 | Transforms/groups         | Position, size, rotation, flips, nested group transforms; group/ungroup only when world geometry can be preserved                                                                                                                       |
| F25 | Z-order/alignment         | Order, align, distribute and duplicate objects with deterministic units; keep connector/timing references coherent                                                                                                                      |
| F26 | Connectors                | Create/edit endpoints, connection sites and line style; deleting targets requires explicit detach/remove policy                                                                                                                         |
| F27 | Drawing effects           | Supported fill/line/alpha/shadow operations; preserve advanced effects, 3D scene and material properties                                                                                                                                |
| F28 | Tables                    | Read/create/edit grid, text, styles, borders, fills, row/column sizes; preserve theme-dependent formatting                                                                                                                              |
| F29 | Merged cells              | Horizontal/vertical merges and split cells, insertion/deletion through spans with explicit conflict rules                                                                                                                               |
| F30 | Image inventory           | List occurrences versus unique media, part hashes, media types, geometry, crop, alt text, source links and inheritance                                                                                                                  |
| F31 | Image insertion           | Insert all image formats required by the documented public API with bounded type/dimension/DPI admission and sizing/fit; cover PNG/JPEG/GIF/BMP/TIFF and explicitly reconcile other documented types; no implicit host lookup           |
| F32 | Image replacement         | Replace one occurrence or an explicitly shared resource; clone/rebind when other occurrences must remain unchanged                                                                                                                      |
| F33 | Image geometry            | Crop, contain/cover/stretch, rotation/flips, opacity and picture borders; deterministic EMU arithmetic                                                                                                                                  |
| F34 | Vector/fallback images    | Preserve EMF/WMF/TIFF/WDP and animated bytes; SVG insertion requires supplied raster fallback and validated relationship/MCE structure; no decoder/transcoder promise                                                                   |
| F35 | Image extraction          | Extract original bytes by occurrence/hash to bounded safe output names; deduplicate only explicitly; no active SVG execution                                                                                                            |
| F36 | Chart inventory           | Types, series, categories, caches, axes, labels, data links and embedded workbooks; distinguish cached values from authoritative data                                                                                                   |
| F37 | Chart editing             | Create/edit category area/bar/column/line/pie/doughnut/radar and XY/bubble families with the tested variants, data, axes and styling; exact variant register required                                                                   |
| F38 | Workbook-backed charts    | Create/synchronize simple embedded chart-data sheets and chart caches/formula ranges; preserve complex workbooks/external data and reject edits requiring unsupported formula calculation                                               |
| F39 | Advanced charts           | Preserve extended/chartEx, combination, 3D, trendline, error bars and unsupported chart substructures; no silent downgrade                                                                                                              |
| F40 | SmartArt                  | Inventory/preserve diagram data, layouts, styles, colors and fallback drawing graph; full semantic layout editing is outside scope                                                                                                      |
| F41 | Equations                 | Inspect/extract and preserve OMML; allow validated authored OMML insertion; no equation typesetter                                                                                                                                      |
| F42 | Audio/video               | Inventory/extract/insert/replace validated local media with poster and relationship consistency; preserve trim/loop/volume metadata; no playback/transcoding                                                                            |
| F43 | Captions/media extensions | Inspect/preserve captions, tracks and modern media extensions; limited edits only after schema mapping and evidence                                                                                                                     |
| F44 | Transitions               | Inspect/edit documented cut/fade/push/wipe settings and advance timing; preserve unsupported transitions such as Morph extensions                                                                                                       |
| F45 | Animation inventory       | Read timing graph, triggers, object targets, sequences and effects without executing them                                                                                                                                               |
| F46 | Animation editing         | Author/edit a documented entrance/emphasis/exit subset and simple triggers; preserve complex timelines/motion paths; reject unsafe retargeting                                                                                          |
| F47 | Hyperlinks/actions        | Read/edit ordinary URLs and intra-deck navigation; preserve unsupported actions, report active actions, never execute them                                                                                                              |
| F48 | Notes                     | Read/create/edit speaker text, notes shapes/master and slide association without conflating slide placeholders with speaker text                                                                                                        |
| F49 | Handouts/print            | Inspect/preserve handout masters, print/view settings and notes page size; supported master text edits require explicit scope                                                                                                           |
| F50 | Comments                  | Read/create/edit legacy comments with author IDs/positions/timestamps; inventory/preserve modern threads/mentions/reactions until separately supported                                                                                  |
| F51 | Metadata/tags             | Read/edit core/custom properties and supported tags; retain custom XML and unsupported property types                                                                                                                                   |
| F52 | Accessibility             | Inspect/edit alt text and supported decorative flags, duplicate titles and object order; report structural checks without claiming accessibility certification                                                                          |
| F53 | Embedded content          | Inventory/extract/preserve opaque objects; create OLE embeddings from explicit bytes plus icon/program metadata as required by the public API; controls/web extensions/3D remain preserve-only; never activate or recurse automatically |
| F54 | Fonts                     | Inventory/preserve font declarations/embedded font parts; no installation, redistribution assurance or font rendering                                                                                                                   |
| F55 | Security/signatures       | Detect macros, encryption, protection, signatures and labels; reject unsupported mutations; explicit signature removal only with graph cleanup                                                                                          |
| F56 | Sanitization              | Explicit removal policy for selected notes/comments/metadata/links/embedded objects; report exactly what remains; no blanket clean-file claim                                                                                           |
| F57 | Templates                 | Typed JSON text/table/image bindings and repeated slides; fail unknown/missing bindings before mutation; no executable expressions                                                                                                      |
| F58 | Batch                     | Prevalidated atomic ordered operations, dry-run effect list, stale-state protection and bounded cumulative resource accounting                                                                                                          |
| F59 | Diff                      | Structural/text/media/relationship changes with deterministic ordering; distinguish effective formatting and raw markup differences; no visual-diff claim                                                                               |
| F60 | Package tools             | Bounded validate/extract/pack, explicit XML-part replacement and content-type/graph validation; no arbitrary filesystem extraction                                                                                                      |

## 6. Command and SDK Contract

The [shared Office CLI specification](office-cli.md) is authoritative for
command structure, names/actions, options, selectors, JSON, SDK operation IDs,
output publication and exit statuses. Implement those conventions unchanged.
Common literal replacement is `text replace`; discovery includes `schema` and
`capabilities`. Every declared format feature MUST map to supported operations
or explicit read/preserve/reject evidence. Ordinary edits MUST NOT require JSON
or internal XML IDs. All supported SDK behavior must be reachable through direct
CLI operations or typed batch, with direct flags for common workflows.

The [shared JavaScript SDK specification](office-sdk.md) adds complete documented
public API coverage with closely mirrored methods/properties and explicit language/
security mappings. It includes keyed placeholders and invalidated handles, full
documented chart object graphs, gradient stops, shape adjustments/freeform builders,
media/OLE return interfaces, units/enums and live inherited properties. These are
requirements even when not individually named in F01–F60. Public behaviors absent
from upstream tests still require original acceptance cases. Whole-text setters
retain their documented destructive scope; preserving text replacement is separate.

PPTX-specific families include `slides`, `shows`, `masters`, `layouts`, `themes`,
`media`, `transitions`, `animations` and `accessibility`. Use resource/action
paths, including `slides add`, `slides move`, `layouts apply` and `shapes set`.
Shared collections are `images`, `tables` and `properties`. Exact format-only
flags belong in this spec and its machine-readable register.

Text defaults to slide-local content in presentation order. Notes, layouts and
masters require explicit scopes. Slide selectors are one-based at the CLI;
SDK collection indexes follow the separately specified JavaScript object model.
Metadata-only autofit and metrics-based best-fit sizing remain distinct; fitting
requires explicit metrics, and never implies identical rendering across fonts.

Both tools use ordinary exit statuses 0/1/2/3/4/130 as defined by the shared
contract. For `diff`, 0 means equal, 1 means different, 2 means comparison trouble,
and 130 means cancellation. A successful difference is not an SDK exception.

### 6.1. Format operation grammar

The operation table in Appendix A is exhaustive for direct commands. Each row
specifies the exact path, input arity, flags, argument schema, applicable options,
SDK ID, scope, cardinality and publication class. The accompanying
[operation register](../pptx/command-coverage.json) defines closed JSON Schema
2020-12 objects at `operations[ID].arguments`, `optionsSchema`, `batchOptions`
and `resultSchema`. Its `$defs` resolve locally. This spec and the shared contracts
are authoritative; the register MUST agree with them. This is a proposed schema
contract, not an executable implementation or a released schema bundle.

`pptx PATH INPUT FLAGS` binds to the typed operation with the same dotted ID.
`text` is the sole shorthand for `text get`. Old singular resources and top-level
replacement are rejected, with usage status 2. No implicit default action is
added for a resource. Only discovery accepts a command path instead of input.

Each listed scalar flag occurs at most once. Presence-only control flags are
`--json`, `--force`, `--in-place`, `--dry-run`, `--all`, `--first`, `--allow-empty`,
`--unique`, `--shared`, `--relationships`, `--raw`, `--graph` and
`--allow-partial-output`. Their omission means false except `validate` always
checks graph integrity. Boolean property flags take literal `true` or `false`,
so `--hidden false` and `--advance-on-click false` can turn a property off.
Nullable formatting flags also accept literal `null`. Strings are not coerced:
`--text null` writes four characters. Numbers use finite decimal notation;
integers reject fractions. Shell quoting is resolved before these rules apply.
Arrays/objects take one shell argument containing JSON, except `--select` and
location-valued flags accept emitted opaque tokens. Object variants, such as
`--target '{"slide":1,"shape":"Heading"}'`, are validated as JSON. No comma-list,
file lookup, expression evaluation or implicit `@file` convention is inferred.
`--ops-json`/`--data-json` decode one JSON text; their `--*-file` counterparts
read the same schema from an explicit capability-scoped input.

For each direct ID `K`, the SDK equivalent is
`execute<K>(operation: K, inputs: readonly BinaryInput[], arguments: Arguments[K],
options: Options[K], context: OfficeContext): Promise<OfficeResult<Data[K]>>`.
`Arguments`, `Options` and `Data` are the exact types of the three corresponding
register schemas; input tuple cardinality follows Appendix A. SDK transport
bytes/sources/sinks are explicit capabilities and never serialized host objects.
CLI VFS descriptors bind to the same admitted bytes. Operations return structured
failures; model methods retain their documented typed exceptions. This operation
surface does not rename the neutral synchronous model properties or methods.

Advanced public behavior is available through the register's closed typed batch
union, including inherited members, enums, helpers, collections and underscore-
prefixed public interfaces. It is not arbitrary member dispatch. `arguments` is
required even when `{}`; optional `options` defaults to `{}`. Receivers must be
owner-checked handles from this invocation or earlier results; handles do not
grant ambient authority. `resultHandle` is a nonempty unique identifier. Forward,
duplicate, foreign or invalidated handles fail before publication. Discovery
lists these typed-only paths and their receiver, argument and result schemas.

### 6.2. Scope, selection and cardinality

The only scopes are `slides`, `notes`, `layouts`, `masters`, `notes-master`,
`handout-master`, `presentation` and `shared`. Resource-specific defaults appear
in Appendix A; an explicitly selected resource family is itself scope intent,
for example `notes set` addresses speaker notes and `masters set` addresses a
master. Shared effects MUST report all affected slides. Scope cannot be widened
by `--all`. Inapplicable scope/selector combinations fail with status 2.

`--slide N` addresses the current slide-list position. `--shape NAME` matches an
exact case-sensitive name within that slide/drawing owner, including nested
children in depth-first XML order. Numeric strings are names, not shape IDs.
`--image N` numbers picture occurrences; `--table N` numbers tables. Paragraphs
and runs number their selected text owner; no cross-owner ordinal flattening is
allowed for mutations. `--cell B2` uses uppercase base-26 columns and one-based
rows. Merged followers alias the origin for reading, but a cell mutation must
select the origin or explicitly select the complete merge range. Invalid,
nonexistent and ambiguous coordinates are distinct errors.

Lists without selectors return the declared collection, including `[]` when
empty. A `get` requires one match except singleton presentation settings and
slide background/notes/transition queries. A missing optional singleton yields
an empty `items` list, never creates content. Other missing `get` targets fail
`missing-selection`; `--allow-empty` is not accepted on reads. A `set`, `remove`
or `replace` requires one target unless its applicable `--all` explicitly selects
a collection. Empty mutations fail unless `--allow-empty`, then succeed with
zero effects. No update fields is a usage error, even with `--allow-empty`.
A supplied value equal to the existing value succeeds with the targeted count
and zero serialized changes. Add operations require one owner, never infer the
first slide/layout. Template creation without an input is a separate operation.

Tokens carry `{fingerprint,scope,owner,objectId,coordinateSystem:"identity"}`.
They are opaque canonical encodings of these fields, not paths to execute.
Fingerprint is SHA-256 of admitted package bytes; owner is a canonical part URI.
New objects in a batch are addressed through result handles. External tokens
are checked against the input snapshot; positions in later batch operations
resolve against the evolving isolated model. Publication compares the original
input fingerprint again. Ambiguous simple names produce bounded candidate
locations; ambiguity is never resolved by choosing the first object.

For `text replace`, exactly one of `--first`, `--all`, `--occurrence N` is required.
First/occurrence count nonoverlapping literal matches across the selected scope
in slide-list, depth-first shape, paragraph and run order. Matching joins adjacent
runs in one paragraph, never fields, paragraph boundaries, separate cells or
shapes. Search is case-sensitive with no normalization, regex or locale folding.
Empty `find` fails; empty `with` deletes. Matching advances by the original match
length, so inserted text is not searched again. `affected` counts replacements;
locations identify the containing text owners. A replacement across runs uses
the first affected run's style and preserves unrelated formatting. Whole `.text`
assignment and `set --text` intentionally retain their destructive model scope.

### 6.3. Values, absence and defaults

Unknown fields, duplicate JSON keys, unknown enum values, nonfinite numbers and
inapplicable flags fail before admission. Absent optional fields in `set` retain
the current value. `undefined` selects documented defaults only at the SDK call
boundary; it is not a JSON value. `null` is accepted only by a nullable schema,
meaning inheritance/absence as specified by that property. It never means zero,
false, empty text, deletion or an empty collection. Removal uses the declared
remove operation. `bold`, `italic` and `wrap` admit true/false/null. Nonnullable
CLI fields do not gain nullable semantics merely because a model setter has them;
the exact nullable model assignment remains available through typed batch.

Empty text/name/value strings are intentional, except lookup names, property
names, file paths, handles and identifiers MUST be nonempty. Required collections
must be nonempty unless defined here: empty table cell text is valid; `Bindings:[]`
and an empty batch are validated no-change operations; empty repeat records
remove the selected prototype slides. Empty `series`, path vertices, selected
slide sets, source lists and sanitization policies are rejected. Field presence
is checked independently of truthiness. JSON booleans never accept 0/1 or strings.

New decks default to an original empty slide list with one original blank layout
and master, 12192000 by 6858000 EMUs, Transitional dialect and `pptx` kind. A
supplied template retains its size/dialect/kind unless explicitly overridden;
unsupported conversion fails. A lone width or height on creation changes only
that dimension. No metadata time/author is synthesized. Slides append unless
position is supplied, have empty name, are visible and follow master background.
New optional text/alt text is empty, rotation is zero, locks/flips are false;
unset style/fill/line properties inherit. Required placement has no default.

On `set`, explicit empty text clears text while preserving required empty
paragraphs. Empty custom shows/sections are rejected on creation and membership
replacement. Setting a name does not rename package parts. New properties require
explicit type; known core strings allow 255 Unicode code points, revision is a
nonnegative integer, and dates use explicit UTC whole seconds. Empty known string
properties are distinct from removed properties. Custom names cannot collide
with core names; `properties get/remove` of an absent name fails. No inferred
custom-property coercion or revision increment is allowed.

Units are case-sensitive `emu`, `in`, `cm`, `mm`, `pt`, with factors 1, 914400,
360000, 36000, 12700. JSON uses `{value:number,unit:...}`. Convert once, nearest,
halfway away from zero; stored EMUs are finite safe integers. Centipoints remain
a model helper (127 EMUs), not an extra common CLI suffix. Width/height, font
size, row/column size and grid spacing must be positive. Margins, border widths,
shadow blur and tolerances may be zero; positions may be negative. Angles are
clockwise degrees in [-360000,360000], normalized modulo 360 only on assignment.
Opacity and gradient-stop positions are fractions [0,1]. Stops are ordered,
at least two, with endpoints 0 and 1; equal positions are allowed in given order.

### 6.4. Slide, drawing and content families

Slide `position` is the final one-based position after removal for a move, or
insertion position in 1..length+1 for add/duplicate. Duplicate/import copies the
relationship closure and remaps collisions deterministically. `slides merge`
requires a destination input plus a nonempty ordered JSON `sources` list;
`sourceSlides` applies the same positions to each source, defaults to all, and
must be valid in each source. Import requires its source and exact slide list.
Selection order is preserved, duplicates rejected. `themePolicy` is required:
`source` imports the original master/theme closure; `destination` matches
placeholders by type/index and rejects unresolved mappings, never flattens styles.
Split emits one deck per selected slide in requested order. Section members must
be contiguous and nonoverlapping; newly supplied show members are ordered unique
slide positions. Unrelated edits preserve repeated entries in existing shows.
Section/show list reordering retains container IDs and does not reorder slides.
Copies inserted strictly inside a section span join that section to retain
contiguity; boundary/outside insertion infers no membership. Existing show
memberships retain their original slide references after duplication.
Deleting slides removes their section/show memberships and empty containers;
other live inbound links/timing targets cause `dangling-reference`. Removing a
custom show referenced by active show settings or navigation also fails with
`dangling-reference`.

Slide insertion binds a required existing layout by exact name or canonical part
URI and follows its uniquely registered master. Omitted `position` appends.
`title` matches `title`/`ctrTitle`; `body` matches `body`/`obj`/`subTitle`.
`placeholders` is an array of closed `{type: string, index?: uint32, text: string}`
objects, supplied as `--placeholders-json` on the CLI. Each assignment must match
exactly one placeholder, and repeated assignments or ambiguous layout indices
fail. Text assignment supports those five text-capable types; rich-content
placeholders retain their types and reject text coercion. New slides retain
layout defaults through inheritance and omit latent date/footer/slide-number
placeholders. Shape IDs belong to the new slide and do not consult other slides.

Master/layout/theme removal fails while referenced. Layout names and master
names are exact scoped lookups. `layouts apply` requires `placeholderPolicy`:
`type-index` matches each placeholder key and keeps unmatched local content;
`reject-unmatched` rejects any unmatched placeholder. Neither chooses among
ambiguous mappings. Master/layout text edits require a selected text shape.
Settings size does not rescale shapes; orientation swaps width/height if needed
and rejects contradictory explicitly supplied dimensions. Theme updates require
paired `colorSlot/color` or `fontSlot/font`; color slots are `dk1`, `lt1`, `dk2`,
`lt2`, `accent1`..`accent6`, `hlink`, `folHlink`; font slots are `majorLatin`,
`minorLatin`, `majorEastAsia`, `minorEastAsia`, `majorComplex`, `minorComplex`.

Background `set` requires `kind` plus exactly the relevant payload: solid color,
gradient stops/angle (angle defaults to zero), or picture file. No inactive fields
are accepted. Shapes use `text-box` or the documented preset enum; unknown presets
are preserve-only. Changing preset kind cannot convert tables, media, charts or
groups. Existing adjustments use the typed model collection, not an unvalidated
formula string. Basic custom paths are one or more move/line subpaths, with
optional close, integer local EMU vertices and no guide formulas, arcs or Bézier
editing. Direct `shapes paths add/set` defines one subpath from at least two
vertices (three distinct vertices if closed), first vertex as move, remaining
vertices as lines. Typed freeform builder operations support multiple subpaths and retain their
documented finite numeric local coordinates and explicit scale; the direct EMU
path schema does not narrow those model inputs.
Curves, arbitrary guides and unsupported geometry are inspect/preserve-only.

Group/ungroup preserves world-space transforms and z-order. Group requires at
least two distinct sibling shapes and an explicit nonnegative EMU tolerance;
ungroup requires one group. Maximum deviation is measured at every transformed
vertex and all four bounding-box corners, per axis, after serialization. Default
tolerance does not exist; zero demands exact geometry. Unsupported geometry whose
bound cannot be established fails. Align requires at least two shapes and uses
the selected union bounding box; distribute requires at least three and equalizes
edge-to-edge gaps along the axis, preserving endpoints. Negative gaps are allowed.
Move changes sibling z-order. Duplicate needs explicit offsets. Connector kinds
are the declared enum; connection sites are zero-based and must exist. A supplied
site applies to both explicitly connected ends. Deleting a referenced target
fails until connectors are explicitly detached/removed; complex timing targets
are never silently dropped. Simple shadow means an outer shadow with zero offset,
explicit blur/color/opacity; advanced shadow/effect stacks remain preserve-only.

Tables require positive rows/columns and a rectangular text grid matching them;
absent data produces empty cells. New row heights/column widths divide the box in
EMU order, giving remainder EMUs to the earliest rows/columns. A `tables set`
text value requires one origin cell; data replaces all cell text with exact grid
cardinality. Rows/columns on set must equal existing dimensions; structural edits
use rows/columns add/remove. Row height/column width applies to the selected cell's
row/column; without a cell it applies to all rows/columns of the selected table.
Merge requires an ordered rectangular `from`..`to` range with no partial existing
span; it combines origin text in row-major order using paragraph breaks. Split
requires one merge origin and leaves text there, with empty released cells.
Insertion through spans requires `expand` or `reject`; deletion through spans
requires `shrink` or `reject`. Deleting a span origin with shrink moves surviving
origin content to the first surviving cell. No zero-row/zero-column table results.

Run underline uses the documented underline enum; strike is `none|single|double`;
baseline is a percentage in [-100,100]. Paragraph levels are 0..8; tabs are ordered
nonnegative lengths. Bullet is one Unicode scalar or empty to remove the bullet;
numbering is `decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none`.
Bullet and numbering are mutually exclusive. Text frames have 1..16 columns;
`autofit none|shape|text` writes metadata only. `text fit` requires admitted
metrics, defaults to the documented model font family/max size/bold/italic values,
and uses points for `maxSize`; it cannot discover or open a host font file.
Field `update preserve` retains cached text; `explicit` requires supplied text,
and date fields also require timestamp. No date or slide number is evaluated
implicitly. Notes add fails if notes already exist; set may create the selected
slide's speaker body. Notes reads never create notes. Legacy comments require
explicit author/time and default position (0,0); modern threads remain preserved.
Tags use exact case-sensitive names within the selected owner.

Links accept exactly one URL, slide target or targetless navigation action;
action must agree with the payload. URLs remain inert strings with explicit
scheme, never fetched; unsafe active actions are preserve-only. Equations accept
one validated OMML document from file, with DTD/entities prohibited. Media insertion
requires explicit MIME type and geometry, admitted local bytes and supplied poster
for video; audio uses an original inert icon when poster is absent. Replacement
retains timing metadata and requires explicit poster. Unsupported codecs remain
opaque, never transcoded. Objects require explicit program metadata/bytes, supplied
icon or original inert default icon, and positive dimensions (default 1in square).
Accessibility setters report structure only. Relationship edits require a selected
source part, existing unique ID for set and new ID for add, and full graph validation.

### 6.5. Images and SVG fallback

Image insertion requires one selected owner and explicit left/top. Native size
uses characterized pixels and DPI. Missing/invalid DPI falls back to 72 per axis;
characterized DPI rounds ties to even then falls back outside 1..2048. Neither
size uses native dimensions, one dimension preserves aspect, both use the supplied
box. Fit defaults to stretch for an explicit box; contain centers uncropped media
inside the box, cover centers and crops to it. Replacement preserves the existing
box/transform/crop unless changed. `--shared` reports and updates every occurrence
of the resource; conflicting per-occurrence geometry with shared replacement fails.

Crop is a signed fraction quantized to 1/100000 with ties away from zero, within
[-21474.83648,21474.83647]. Negative crops and values greater than one remain valid
if both `1-left-right` and `1-top-bottom` are positive. No clamping is allowed.
Opacity does not modify source pixels. Extract returns original bytes, never a
rendered crop. PNG/JPEG/GIF/BMP/TIFF receive bounded dimension/DPI characterization;
other admitted vector/animated bytes remain preserve/extract-only unless explicitly
covered by a typed API characterization capability. No decoder process is implied.

SVG add/replace requires an admitted PNG or JPEG fallback through `--fallback`.
Both inputs are size-bounded and type-checked. SVG requires a valid finite positive
viewBox or explicit dimensions and preserves inert bytes; script, event handlers,
foreignObject, external references, DTD/entities, external CSS and executable URLs
are rejected. Fragment-local references are permitted with bounded cycle detection.
No network, browser execution or rasterization is attempted. The fallback's visual
accuracy is caller responsibility and must be established by independent QA.

The ordinary picture blip points to the raster part; an SVG extension points to
the SVG part using a distinct internal relationship. The extension namespace is
marked ignorable, and existing AlternateContent choices/fallbacks are retained.
The extension and fallback cannot dangle. Replacement of one occurrence clones
shared relationship resources as needed; removing an occurrence removes only
unreachable parts. Raw SVG is never emitted as active HTML. SVG without fallback
fails `unsupported-edit`, not a warning or an automatic conversion.

### 6.6. Chart and timing subsets

Chart creation accepts exactly the 29 enum symbols in Appendix B. Category families
require nonempty categories and equal-length series values. Category label types
are homogeneous string/number/UTC-date; the typed model additionally supports
hierarchical categories with consistent depth. Direct JSON flat categories do not
silently flatten hierarchical input. Pie/doughnut require exactly one series.
XY families forbid categories and require equal-length xValues/values per series;
bubble additionally requires matching nonnegative bubbleSizes. Null y/category
values mean a missing point with a retained index; null x or size is rejected.
NaN/infinity and empty series are rejected. Empty series names remain valid.

Style is 1..48 or omitted for theme default; title is absent by default (empty
creates an empty title), legend defaults false. `charts set --data` has the same
simple workbook synchronization rule as `charts replace`. `synchronize-simple`
rewrites the owned data sheet, formula ranges and caches atomically;
`reject-complex` performs the same synchronization only when the workbook is
already simple. Both reject external data, unsupported formulas, additional
unrelated sheets/tables or ambiguous ownership; neither means cache-only editing.
Date categories use the existing 1900/1904 date system, default 1900 on creation.
No calculation/refresh or formula evaluation occurs.

Existing chart properties, including axes, gridlines, legends, points, markers,
labels and series, retain all documented typed getters/setters even on graphs
whose construction is unsupported. Such a setter may only edit its supported
local structure; changes requiring reconstruction of unknown content fail.
Combination, general 3D, chartEx, trendlines, error bars and unsupported extensions
are preserve-only substructures, not an excuse to hide public scalar properties.
The bubble three-dimensional decoration does not authorize general 3D creation.

Transition add fails if a transition exists; set may create one when kind is
supplied. Cut/fade forbid direction; push/wipe require direction. Duration,
advanceAfter, animation delay and duration are integer milliseconds in
0..2147483647; no seconds conversion or clock reading occurs. Transition duration
defaults 500, advanceOnClick true, and absent advanceAfter disables automatic
advance. Cut duration is zero; a nonzero explicit cut duration is rejected.
Setting automatic advance to zero is immediate advance, distinct from absence.
Removing a transition clears its advance metadata. Unsupported transitions,
including complex extension effects, are preserve-only.

Animation creation supports appear (entrance), fade-in (entrance), fade-out (exit)
and pulse (emphasis), on one shape in one slide's main sequence. Target is an
emitted token or `{slide,shape}` lookup; named lookup must be unique. The target
cannot be a subrun, paragraph, chart point, master or foreign slide. Add appends
after the current last supported effect. Trigger is required: on-click starts a
click group, with-previous starts with the preceding effect, after-previous starts
after its end. The latter two require a preceding effect in the same simple
sequence. Delay defaults zero, duration 500 except appear duration zero. Pulse is
one scale cycle to 110% about the center and back, fade changes only opacity.
No repeat, motion path, sound trigger, interactive sequence or additive composition
is authored. Timing must be representable without touching complex siblings;
otherwise add/set/remove fails `unsupported-edit`. Reads retain unknown timing
nodes and report targets without execution. Removal cannot strand another effect's
trigger; callers must explicitly retarget that effect first in an atomic batch.

### 6.7. JSON results, errors and publication

Every result is the shared eight-field envelope. `data` MUST validate against the
selected operation's `resultSchema`; all properties are closed unless they are
explicitly JSON Schema meta-schema content in discovery. The exact wire definitions
appear in Appendix C. A model handle is serialized as the registered typed handle,
bytes as explicit base64, dates as UTC, lengths as value/unit. Resource reports use
ordered fields whose names/types are declared by that resource's discovery schema;
unknown names are not extension dispatch. Empty lists remain `[]`; absent nullable
values remain tagged null. Inspection never invokes a creating getter.

Mutation data reports effects, output manifest and the resulting fingerprint;
dry-run has an empty manifest and null resulting fingerprint. Reads have affected
zero; mutation affected counts directly targeted objects, including unchanged
selected objects. Cascaded relationship cleanup and inherited slide impact appear
as effects, not inflated direct counts. Multi-file data is an ordered manifest of
safe paths, byte counts and SHA-256. Batch result data is an ordered per-item result
list plus one output manifest; pure-read/empty batches require no destination.

Diagnostics include bounded code/message and context: phase, optional zero-based
operationIndex, argument JSON pointer, location, feature and candidate locations.
Only applicable fields appear; no document content, raw bytes or host paths leak.
Usage/schema errors occur before input reads (exit 2); invalid content, missing,
ambiguous or stale selection and unsupported edits are exit 1; I/O/publication is
3, limits 4, cancellation 130. `diff` uses its shared 0/1/2/130 profile. On failure,
data is null, affected zero and errors nonempty, except explicitly authorized
partial publication carries the exact output manifest. There is no success warning
that permits data loss. In-place stale checks remain mandatory even after dry-run.

Every invocation reserves stdin for at most one consumer before reading. Input
`-`, file descriptors with `vfsPath:"-"`, nested template/image sources, and merge
sources all count; stdin holding an operations/data file cannot also hold one of
its nested resources. SDK byte sources are separate explicit capabilities, not
aliases for process stdin. Empty binary input is invalid-archive; empty JSON input
is a schema error. No command searches the host filesystem or discovers resources.

Publication class in Appendix A is exact: `none`, `package`, `package-if-mutating`
or `output-directory`. Package output requires output/in-place under the shared
rules. Creation and pack require output, never in-place. Directory operations
require output-dir, reject binary stdout, and use adapter transactions or explicit
allow-partial-output. Output names are `slide-NNNNNN.pptx` for split and
`part-NNNNNN.EXT` for extracted parts/media, numbered in emitted order; EXT comes
from admitted content type or `bin`, never an input path. A manifest records
source locations separately. `pack --manifest` consumes PackManifest with unique
canonical part URIs, explicit scoped files and matching hashes; no directory scan
or arbitrary path extraction. It requires a complete validated package graph.
Sanitize requires a nonempty explicit policy and reports retained unsupported
content. Signature removal requires all=true and removes the complete signature
graph; it does not validate signatures or bypass protection.

### 6.8. Resolved model language mappings

Model names retain neutral documented spellings and positional order; keyword-only
fields become trailing typed options with retained names. Reserved positional
`default` is bound as `default_value`. Factories/admission/save are always async;
in-memory operations and metrics-based fitting remain synchronous. Byte/Date
results are copies; model handles are live, owned, and invalidated on replacement.
Sequence numeric lookup is zero-based and bounds-checked; sparse placeholders use
idx keys. Only declared collections support `.at` or `.slice(start,end,step)`;
slices normalize negatives, clamp bounds and require nonzero integer step.

EMU helpers are value objects; centipoints accessor floors division by 127.
RGB channels are integers 0..255 with six-digit hex parsing. UTC property dates
serialize whole seconds. Chart dates ignore time-of-day: 1900 serial dates use
1899-12-31 and add one after day 59; 1904 dates use 1904-01-01. Enum symbols/aliases
remain immutable typed values; `PERCENT_40` maps to 6/`pct40`, and `SLIDE_IMAGE`
remains available. Unsupported creation enum values still exist for inspection.

Value/type/index/key failures map respectively to ValueError/invalid-value,
TypeError/invalid-type, IndexError/index-out-of-range and KeyError/missing-key.
Unavailable properties use PropertyAccessError/property-unavailable; read-only
assignment uses read-only-property; invalidated handles use
InvalidHandleError/invalid-handle. XML and package I/O use InvalidXmlError/invalid-xml
and PackageNotFoundError/io-failure. There is no branded exception alias.

Corrected public returns are GraphicFrame for chart insertion and Movie for movie
insertion. The documented follow_master_background setter remains required.
Freeform closure uses add_line_segments with close=true; no fictitious close method
is added. Cell coordinates come from table traversal/reporting, not invented
row_idx/col_idx members. Absent RGB access raises PropertyAccessError; theme_color
returns NOT_THEME_COLOR for an existing nonscheme color and errors for absence.
Public XML/package views are bounded owner-aware capabilities, never unrestricted
XPath, callbacks, host objects or dependency-runtime emulation. Documentation
errors do not become API promises, and private-looking names do not waive public
coverage. The API register retains exact member-by-member mappings and original
acceptance obligations, including APIs with no prior tests.

## 7. Resource Limits and Units

Initial ceilings below are proposed defaults to validate against the corpus.
The host sets upper bounds; callers can lower them. Larger trusted QA profiles
MUST be named and recorded separately from default-profile outcomes.

| Resource                                        | Default ceiling |
| ----------------------------------------------- | --------------- |
| Compressed input per deck                       | 256 MiB         |
| Actual expanded package bytes                   | 1 GiB           |
| Entries                                         | 50,000          |
| XML bytes per part                              | 32 MiB          |
| XML depth                                       | 256             |
| XML nodes per operation                         | 5,000,000       |
| Slides                                          | 5,000           |
| Shapes across selected graph                    | 250,000         |
| Individual media part                           | 256 MiB         |
| Decoded image pixels, if decoding is introduced | 100 megapixels  |
| Output package                                  | 512 MiB         |
| Batch operations                                | 1,000           |

All actual reads, decompression, graph traversal, clones and output writes count
toward limits. Declared sizes alone are insufficient. Diff/merge/batch charge
combined work, not fresh budgets per input or operation. CPU work MUST yield and
observe cancellation; cycles need visited sets and bounded traversal. Timeouts
are supplied by the host, not hidden clock reads in deterministic model operations.

Geometry uses integer EMUs; explicit CLI units include EMU, inch, cm, mm and pt.
Conversions MUST round once by a documented rule and reject nonfinite/overflow
values. Positive sizes are required. Negative offsets are allowed within numeric
limits and reported as off-slide, not silently clamped. Rotation and nested group
transforms MUST use documented units. Crop percentages MUST have bounded semantics
and reject a zero visible extent. Lossy rounding on group/ungroup needs an explicit
tolerance or rejection; the editor MUST NOT invent visually equivalent geometry.

## 8. Processing and Publication

An operation proceeds through admit, parse, index, select, validate intent, mutate
an isolated graph, validate result, serialize and publish. Failures before publish
MUST leave inputs and destinations unchanged. Batch syntax is validated completely
before the first mutation; its semantics then follow listed order. Selection tokens
for changed objects MUST be refreshed or addressed through explicit created-object
handles. Dry-run executes selection and validation but performs no output mutation.

Local/virtual publication uses the adapter's documented atomic replacement or
conditional-write capability. In-place edits MUST fail before writing when the
adapter cannot protect against stale input and partial replacement. The engine
MUST NOT invent remote atomicity. Multi-file split/extraction requires staging and
an adapter transaction, or an explicit non-atomic mode with a precise partial-output
manifest. Stdout cannot be rolled back: validate/stage the complete bounded package
before emitting it, and report transport failures without claiming atomic delivery.

No-op editing SHOULD return original bytes. Unmodified part bytes MUST remain
identical. Changed XML parts MUST retain unrelated nodes, attributes, extension
payloads, namespace meaning and whitespace. ZIP container bytes need not remain
identical after an edit; decoded unmodified entries and their meaning must.
New IDs/names and serialization order MUST be deterministic for identical inputs.

## 9. Editing Invariants

Slide order follows the presentation slide list, never filename sorting. Reorder
MUST retain slide identity, notes, timings and internal links. Delete MUST inspect
custom shows, sections, actions, zoom/timing extensions and other incoming edges;
unresolved opaque references require rejection or an explicit verified policy.

Cross-deck copying MUST remap slide/shape/relationship IDs in every supported
reference namespace, import required masters/layouts/themes and preserve source
appearance by default. Deduplication requires structural equivalence, not filenames
or theme names. Applying the destination theme is a separate operation with an
effect report. Unsupported references that cannot be remapped cause rejection.

Effective text/shape properties resolve slide overrides, matching layout/master
placeholders, text styles and themes according to the standards. Inspection MUST
separate explicit values, inherited values and unresolved values, with provenance.
The editor MUST NOT materialize all inherited values during unrelated edits.

Cross-run replacement MUST retain formatting outside replaced ranges, avoid cutting
surrogate pairs and preserve paragraph/field boundaries unless explicitly selected.
Replacement inherits the first affected run's style by default. Regex search is
outside the first contract. Shape-tree order is a structural extraction order;
layout-based reading order and measured text overflow require a renderer.

Replacing a single picture occurrence MUST leave other occurrences unchanged even
when they share a media part. Replacing a shared resource requires explicit intent
and affected-occurrence reporting. Original image bytes MUST be retained on extract.
SVGs and embedded objects are data; no external resolution or execution is allowed.

Shape deletion and ID remapping MUST account for connectors, timing targets,
comments, actions and extension references. Complex animation graphs may be retained
unchanged but MUST NOT be silently discarded to make a structural edit succeed.
Chart editing MUST not leave stale embedded workbook data, caches or formulas.
Generated and supported simple embedded chart-data sheets MUST keep cells, shared
strings, series/category ranges, date systems and caches consistent. Arbitrary
formula evaluation and external-data refresh are unsupported. Workbook-backed
changes needing those capabilities fail before mutation.

Signatures invalidate on mutation: signed packages MUST reject edits by default.
An explicit strip-signatures operation removes the complete signature relationship
graph before other changes and reports this effect. This is not signature validation.
The engine MUST not bypass protected/encrypted content or claim rights-label removal
grants access. Macro-bearing packages MUST be detected from content as well as suffix
and rejected for mutation; no executable payload is ever activated during reads.

## 10. Failure Model and Observability

Errors include `invalid-archive`, `invalid-xml`, `invalid-opc`, `unsupported-profile`,
`unsupported-edit`, `ambiguous-selection`, `stale-input`, `missing-binding`,
`dangling-reference`, `resource-limit`, `unsafe-path`, `protected-content`,
`publication-unsupported`, `io-failure` and `cancelled`. Only explicitly marked I/O
failures are retryable; invalid inputs/unsupported edits need corrected intent.

The parser MUST reject DTDs, external entities, duplicate/colliding part names,
encrypted/multi-disk ZIPs, traversal, unsafe URI encoding and symlink-like entries.
It MUST verify actual stream sizes, CRC and local/central ZIP consistency. Unknown
namespace content is preserved, not fetched. No warning automatically downgrades
a fidelity requirement. Rejected edits MUST return the unsupported object/feature
identifier without dumping its sensitive contents.

Reports MUST distinguish operation success, schema validation, semantic validation,
renderer results and visual inspection. A valid CRC/XML census proves none of the
last four. Timing/media inventory does not prove playback; image presence does not
prove that an image is displayed. Cached thumbnails are not current render output.

## 11. QA Fixture Lifecycle

Downloaded decks in `.cache/pptx-corpus` are disposable QA fixtures only. They MUST
NOT ship, be committed, become canonical unit-test dependencies or supply copied
text/images for regressions. The durable manifest records source/landing URL,
retrieval date, hash, measured bytes/structure, license evidence and QA status.
Public availability MUST NOT be recorded as blanket redistribution permission.

Keep source downloads immutable during QA; mutate owned copies. For each meaningful
failure or behavior, reduce the essential structure into a small original in-memory
fixture with an independent expected result. Use original wording, authored images
and generated minimal XML/media. Unit tests MUST use memfs for file mutation, avoid
network/disk/LLM calls and remain fast. A regression is not closed until its reduced
test demonstrates the failure and the verified fix.

After QA and regression reduction, delete only enumerated owned downloads and QA
outputs if no active campaign needs them. Retain the manifest, concise evidence and
small original tests. QA procedures MUST be agent-executed Markdown in `docs/plans`,
not a committed QA runner script. Acquisition/census preparation is not product QA.

## 12. Test and Validation Matrix

The implementation MUST account for every collected parameter variant and expanded
BDD example in the pinned research inventory. Every applicable behavioral case
MUST have original TypeScript acceptance evidence. Python-private mechanics MAY
map to equivalent observable invariants with a documented rationale; difficult
public functionality MUST NOT be dismissed as an architecture-only difference.
Any deferred public behavior is a visible scope gap and prevents parity claims.
This test baseline supplements the standards matrix, not replaces it.

| Requirement families                   | Required evidence                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01–F04 package/XML                    | Independent tiny malformed/valid ZIP/XML cases, Strict/Transitional and MCE cases; untouched part hashes                                          |
| F05–F14 presentation graph             | Original multi-master decks, shuffled part names, duplicate shape IDs across slides, inherited overrides and merge/split reference assertions     |
| F15–F21 text                           | Exact Unicode text/run spans, fields, RTL/CJK and inherited style provenance; no visual-order assumptions                                         |
| F22–F29 drawing/tables                 | Integer geometry and nested transforms, connector targets, merge spans, unsupported-effect preservation                                           |
| F30–F35 pictures                       | Authored raster/vector fallback cases, shared bytes with independent occurrences, exact extraction hashes and crop geometry                       |
| F36–F41 charts/diagrams/math           | Independent chart XML/cache expectations, workbook-backed rejection, opaque graph hashes and OMML preservation                                    |
| F42–F47 media/timing/actions           | Original tiny authored media, poster/relationship checks, timing target remapping, unsupported timeline rejection; no playback claim from parsing |
| F48–F55 notes/review/metadata/security | Notes association, legacy author IDs, modern extension retention, protected/signed/macro rejection                                                |
| F56–F60 workflows                      | Atomic failure/cancellation/stale-input tests, binding cardinality, exact diff and extraction manifests, bounded cumulative work                  |
| CLI/SDK/safe-bash                      | Matching arguments/results/errors, quoting and pipes, `.sh` script execution, rooted memory/real/remote adapters and capability-denial tests      |
| Real presentation fidelity             | Downloaded large and image/media-heavy decks: successful targeted edits and independent reopening, render comparison and inspected screenshots    |

Independent application checks SHOULD include PowerPoint when available and an
independent reader/renderer such as LibreOffice. Record exact version, platform and
font availability. Compare unmodified input and edited output in the same renderer;
inspect expected changes and untouched slides, notes and master-driven appearance.
Cover animations/media by application playback only where supported and available;
record unrun cases honestly. Rendering MUST NOT be used to bless a damaged graph.

## 13. Conformance Criteria

Completion requires evidence for every declared read/edit/preserve/reject promise
in F01–F60, stable CLI/SDK parity, maintained checks, independent fidelity QA and
original regression reduction. A release support table MUST expose limitations.
No percentage of code coverage alone demonstrates conformance. Overall full ISO
conformance MUST NOT be claimed from this feature matrix.

## 14. Open Decisions

Before implementation readiness: pin extension schemas; validate limit defaults
against actual media decks; specify the exact basic chart/animation/path subsets
and complete CLI grammar; establish independent renderer availability and fonts.
These are bounded research tasks in the plan, not implicit support promises.
New package READMEs remain subject to repository permission; draft usage/config
documentation under `docs/pptx` and report that publication dependency explicitly.

## Appendix A. Direct operation register

All rows are proposed. `?` marks optional arguments; other arguments are required.
Names before `:` are exact flags; values follow §6.1 encoding. Every row has the
same dotted SDK ID as its space-separated path. Input arity counts document
positionals, not auxiliary `--source`, `--sources`, `--template` or file arguments.
The `arguments` and `optionsSchema` JSON objects in the linked register are exact;
no additional fields/options are accepted. Shared options retain their fixed
names. Nondefault object-member operations execute through the closed typed batch
schemas, not extra undocumented direct flags.

### A. create

| Path / SDK ID       | Inputs | Arguments (exact flags and types)                                                                                                 | Applicable options                                                                 | Scope; cardinality; publication                              |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `create` / `create` | 0      | `--template?: Input`; `--width?: Length`; `--height?: Length`; `--kind?: pptx / potx / ppsx`; `--dialect?: strict / transitional` | `--json`, `--limit`, `--output`, `--force`, `--dry-run`, `--timestamp`, `--author` | presentation; operation-specific in format contract; package |

### A. inspect

| Path / SDK ID         | Inputs | Arguments (exact flags and types)                                                       | Applicable options                                    | Scope; cardinality; publication                                   |
| --------------------- | ------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `inspect` / `inspect` | 1      | `--feature?: string`; `--part?: string`; `--relationships?: boolean`; `--raw?: boolean` | `--json`, `--limit`, `--select`, `--scope`, `--slide` | presentation; collection; omitted filter means all in scope; none |

### A. validate

| Path / SDK ID           | Inputs | Arguments (exact flags and types)                   | Applicable options  | Scope; cardinality; publication                           |
| ----------------------- | ------ | --------------------------------------------------- | ------------------- | --------------------------------------------------------- |
| `validate` / `validate` | 1      | `--profile?: default / strict`; `--graph?: boolean` | `--json`, `--limit` | presentation; operation-specific in format contract; none |

### A. text

| Path / SDK ID                                   | Inputs | Arguments (exact flags and types)                                                                                                                                                                                                                                                                                                                                      | Applicable options                                                                                                                                                                        | Scope; cardinality; publication                                    |
| ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `text get` / `text.get`                         | 1      | none                                                                                                                                                                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `text replace` / `text.replace`                 | 1      | `--find: string`; `--with: string`; `--first?: boolean`; `--occurrence?: Position`                                                                                                                                                                                                                                                                                     | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `text runs list` / `text.runs.list`             | 1      | none                                                                                                                                                                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `text runs get` / `text.runs.get`               | 1      | none                                                                                                                                                                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`                                                                             | slides; one; ambiguity fails; none                                 |
| `text runs set` / `text.runs.set`               | 1      | `--text?: string`; `--font?: string`; `--size?: Length`; `--language?: string`; `--bold?: boolean / null`; `--italic?: boolean / null`; `--underline?: "none" / MSO_TEXT_UNDERLINE_TYPE`; `--strike?: none / single / double`; `--baseline?: number≥-100≤100`; `--capitalization?: none / small / all`; `--spacing?: Length`; `--color?: Color`; `--highlight?: Color` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `text paragraphs list` / `text.paragraphs.list` | 1      | none                                                                                                                                                                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `text paragraphs get` / `text.paragraphs.get`   | 1      | none                                                                                                                                                                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`                                                                             | slides; one; ambiguity fails; none                                 |
| `text paragraphs set` / `text.paragraphs.set`   | 1      | `--text?: string`; `--alignment?: left / center / right / justify / distributed`; `--space-before?: Length`; `--space-after?: Length`; `--indent?: Length`; `--level?: integer≥0≤8`; `--bullet?: string`; `--numbering?: decimal / lower-alpha / upper-alpha / lower-roman / upper-roman / none`; `--tabs?: Length[]`; `--direction?: ltr / rtl`                       | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `text frames list` / `text.frames.list`         | 1      | none                                                                                                                                                                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `text frames get` / `text.frames.get`           | 1      | none                                                                                                                                                                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`                                                                             | slides; one; ambiguity fails; none                                 |
| `text frames set` / `text.frames.set`           | 1      | `--text?: string`; `--margin-left?: Length`; `--margin-right?: Length`; `--margin-top?: Length`; `--margin-bottom?: Length`; `--vertical-anchor?: top / middle / bottom`; `--columns?: integer≥1≤16`; `--wrap?: boolean / null`; `--autofit?: none / shape / text`; `--rotation?: Degrees`                                                                             | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `text fit` / `text.fit`                         | 1      | `--font-family?: string`; `--max-size?: number`; `--bold?: boolean`; `--italic?: boolean`; `--metrics: FontMetrics`                                                                                                                                                                                                                                                    | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--table`, `--cell`, `--paragraph`, `--run`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |

### A. images

| Path / SDK ID                       | Inputs | Arguments (exact flags and types)                                                                                                                                                                                                                                                                             | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `images list` / `images.list`       | 1      | `--unique?: boolean`                                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--image`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `images get` / `images.get`         | 1      | none                                                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--image`                                                                             | slides; one; ambiguity fails; none                                 |
| `images add` / `images.add`         | 1      | `--file: Input`; `--width?: Length`; `--height?: Length`; `--fit?: contain / cover / stretch`; `--left?: Length`; `--top?: Length`; `--fallback?: Input`                                                                                                                                                      | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--image`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `images replace` / `images.replace` | 1      | `--file: Input`; `--width?: Length`; `--height?: Length`; `--fit?: contain / cover / stretch`; `--left?: Length`; `--top?: Length`; `--fallback?: Input`; `--shared?: boolean`                                                                                                                                | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--image`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `images set` / `images.set`         | 1      | `--crop-left?: CropFraction`; `--crop-right?: CropFraction`; `--crop-top?: CropFraction`; `--crop-bottom?: CropFraction`; `--rotation?: Degrees`; `--flip-horizontal?: boolean`; `--flip-vertical?: boolean`; `--opacity?: Ratio`; `--border-color?: Color`; `--border-width?: Length`; `--alt-text?: string` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--image`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `images extract` / `images.extract` | 1      | none                                                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--image`, `--output-dir`, `--force`, `--allow-partial-output`                        | slides; operation-specific in format contract; output-directory    |
| `images remove` / `images.remove`   | 1      | none                                                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--image`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. properties

| Path / SDK ID                             | Inputs | Arguments (exact flags and types)                                                       | Applicable options                                                               | Scope; cardinality; publication                                   |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `properties list` / `properties.list`     | 1      | `--name?: string`                                                                       | `--json`, `--limit`, `--scope`                                                   | presentation; collection; omitted filter means all in scope; none |
| `properties get` / `properties.get`       | 1      | `--name: string`                                                                        | `--json`, `--limit`, `--scope`                                                   | presentation; one; ambiguity fails; none                          |
| `properties set` / `properties.set`       | 1      | `--name: string`; `--value: PropertyValue`; `--type?: string / number / boolean / date` | `--json`, `--limit`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run` | presentation; one; ambiguity fails; package                       |
| `properties remove` / `properties.remove` | 1      | `--name: string`                                                                        | `--json`, `--limit`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run` | presentation; one; ambiguity fails; package                       |

### A. batch

| Path / SDK ID     | Inputs | Arguments (exact flags and types)           | Applicable options                                                    | Scope; cardinality; publication                                          |
| ----------------- | ------ | ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `batch` / `batch` | 1      | `--ops-file?: Input`; `--ops-json?: string` | `--json`, `--limit`, `--output`, `--in-place`, `--force`, `--dry-run` | presentation; operation-specific in format contract; package-if-mutating |

### A. template

| Path / SDK ID                       | Inputs | Arguments (exact flags and types)             | Applicable options                                                    | Scope; cardinality; publication                              |
| ----------------------------------- | ------ | --------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `template apply` / `template.apply` | 1      | `--data-file?: Input`; `--data-json?: string` | `--json`, `--limit`, `--output`, `--in-place`, `--force`, `--dry-run` | presentation; operation-specific in format contract; package |

### A. diff

| Path / SDK ID   | Inputs | Arguments (exact flags and types)                                                 | Applicable options  | Scope; cardinality; publication                           |
| --------------- | ------ | --------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------- |
| `diff` / `diff` | 2      | `--mode?: structural / text / media / relationships / effective-formatting / raw` | `--json`, `--limit` | presentation; operation-specific in format contract; none |

### A. help

| Path / SDK ID   | Inputs | Arguments (exact flags and types)                           | Applicable options | Scope; cardinality; publication                     |
| --------------- | ------ | ----------------------------------------------------------- | ------------------ | --------------------------------------------------- |
| `help` / `help` | 0      | `<path>?: string[]`; `--type?: string`; `--member?: string` | `--json`           | slides; operation-specific in format contract; none |

### A. schema

| Path / SDK ID       | Inputs | Arguments (exact flags and types)                           | Applicable options | Scope; cardinality; publication                     |
| ------------------- | ------ | ----------------------------------------------------------- | ------------------ | --------------------------------------------------- |
| `schema` / `schema` | 0      | `<path>?: string[]`; `--type?: string`; `--member?: string` | `--json`           | slides; operation-specific in format contract; none |

### A. capabilities

| Path / SDK ID                   | Inputs      | Arguments (exact flags and types) | Applicable options | Scope; cardinality; publication                             |
| ------------------------------- | ----------- | --------------------------------- | ------------------ | ----------------------------------------------------------- |
| `capabilities` / `capabilities` | zero-or-one | none                              | `--json`           | slides; collection; omitted filter means all in scope; none |

### A. version

| Path / SDK ID         | Inputs | Arguments (exact flags and types) | Applicable options | Scope; cardinality; publication                     |
| --------------------- | ------ | --------------------------------- | ------------------ | --------------------------------------------------- |
| `version` / `version` | 0      | none                              | `--json`           | slides; operation-specific in format contract; none |

### A. xml

| Path / SDK ID                             | Inputs | Arguments (exact flags and types)                               | Applicable options                                                                           | Scope; cardinality; publication                        |
| ----------------------------------------- | ------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `xml get` / `xml.get`                     | 1      | `--part: string`                                                | `--json`, `--limit`                                                                          | slides; one; ambiguity fails; none                     |
| `xml set` / `xml.set`                     | 1      | `--part: string`; `--file: Input`                               | `--json`, `--limit`, `--select`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run` | slides; one; ambiguity fails; package                  |
| `xml nodes add` / `xml.nodes.add`         | 1      | `--parent: Location`; `--node: XmlNode`; `--position: Position` | `--json`, `--limit`, `--select`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run` | slides; operation-specific in format contract; package |
| `xml nodes remove` / `xml.nodes.remove`   | 1      | `--target: Location`                                            | `--json`, `--limit`, `--select`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run` | slides; one; ambiguity fails; package                  |
| `xml nodes replace` / `xml.nodes.replace` | 1      | `--target: Location`; `--node: XmlNode`                         | `--json`, `--limit`, `--select`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run` | slides; one; ambiguity fails; package                  |

### A. extract

| Path / SDK ID         | Inputs | Arguments (exact flags and types) | Applicable options                                                       | Scope; cardinality; publication                                       |
| --------------------- | ------ | --------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `extract` / `extract` | 1      | `--parts?: string[]`              | `--json`, `--limit`, `--output-dir`, `--force`, `--allow-partial-output` | presentation; operation-specific in format contract; output-directory |

### A. pack

| Path / SDK ID   | Inputs | Arguments (exact flags and types)                  | Applicable options                                                                 | Scope; cardinality; publication                              |
| --------------- | ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pack` / `pack` | 0      | `--manifest: Input`; `--kind?: pptx / potx / ppsx` | `--json`, `--limit`, `--output`, `--force`, `--dry-run`, `--timestamp`, `--author` | presentation; operation-specific in format contract; package |

### A. sanitize

| Path / SDK ID           | Inputs | Arguments (exact flags and types)                             | Applicable options                                                                              | Scope; cardinality; publication                              |
| ----------------------- | ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `sanitize` / `sanitize` | 1      | `--remove: notes / comments / properties / links / objects[]` | `--json`, `--limit`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; operation-specific in format contract; package |

### A. slides

| Path / SDK ID                           | Inputs | Arguments (exact flags and types)                                                                                             | Applicable options                                                                                                                | Scope; cardinality; publication                                    |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `slides list` / `slides.list`           | 1      | none                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `slides get` / `slides.get`             | 1      | none                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; one; ambiguity fails; none                                 |
| `slides set` / `slides.set`             | 1      | `--layout?: string`; `--name?: string`; `--position?: Position`; `--hidden?: boolean`; `--follow-master-background?: boolean` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `slides add` / `slides.add`             | 1      | `--layout: string`; `--name?: string`; `--position?: Position`; `--hidden?: boolean`; `--follow-master-background?: boolean`; `--title?: string`; `--body?: string`; `--placeholders-json?: PlaceholderText[]`  | `--json`, `--limit`, `--output`, `--in-place`, `--force`, `--dry-run` | slides; operation-specific in format contract; package             |
| `slides remove` / `slides.remove`       | 1      | none                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `slides duplicate` / `slides.duplicate` | 1      | `--position: Position`                                                                                                        | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `slides move` / `slides.move`           | 1      | `--position: Position`                                                                                                        | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `slides merge` / `slides.merge`         | 1      | `--sources: Input[]`; `--source-slides?: Position[]`; `--theme-policy: source / destination`                                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `slides split` / `slides.split`         | 1      | `--slides: Position[]`                                                                                                        | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output-dir`, `--force`, `--allow-partial-output`                        | slides; operation-specific in format contract; output-directory    |
| `slides import` / `slides.import`       | 1      | `--source: Input`; `--source-slides: Position[]`; `--theme-policy: source / destination`                                      | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |

### A. sections

| Path / SDK ID                         | Inputs | Arguments (exact flags and types)                                   | Applicable options                                                                                                                | Scope; cardinality; publication                                          |
| ------------------------------------- | ------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `sections list` / `sections.list`     | 1      | none                                                                | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | presentation; collection; omitted filter means all in scope; none        |
| `sections get` / `sections.get`       | 1      | none                                                                | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | presentation; one; ambiguity fails; none                                 |
| `sections set` / `sections.set`       | 1      | `--name?: string`; `--slides?: Position[]`; `--position?: Position` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; one unless explicit all; zero requires allowEmpty; package |
| `sections add` / `sections.add`       | 1      | `--name: string`; `--slides: Position[]`; `--position?: Position`   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; operation-specific in format contract; package             |
| `sections remove` / `sections.remove` | 1      | none                                                                | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; one unless explicit all; zero requires allowEmpty; package |

### A. shows

| Path / SDK ID                   | Inputs | Arguments (exact flags and types)          | Applicable options                                                                                                                | Scope; cardinality; publication                                          |
| ------------------------------- | ------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `shows list` / `shows.list`     | 1      | none                                       | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | presentation; collection; omitted filter means all in scope; none        |
| `shows get` / `shows.get`       | 1      | none                                       | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | presentation; one; ambiguity fails; none                                 |
| `shows set` / `shows.set`       | 1      | `--name?: string`; `--slides?: Position[]`; `--position?: Position` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; one unless explicit all; zero requires allowEmpty; package |
| `shows add` / `shows.add`       | 1      | `--name: string`; `--slides: Position[]`; `--position?: Position`   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; operation-specific in format contract; package             |
| `shows remove` / `shows.remove` | 1      | none                                       | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; one unless explicit all; zero requires allowEmpty; package |

### A. settings

| Path / SDK ID                     | Inputs | Arguments (exact flags and types)                                                                                                                                                                                                                                         | Applicable options                                                    | Scope; cardinality; publication                                   |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `settings list` / `settings.list` | 1      | none                                                                                                                                                                                                                                                                      | `--json`, `--limit`                                                   | presentation; collection; omitted filter means all in scope; none |
| `settings get` / `settings.get`   | 1      | none                                                                                                                                                                                                                                                                      | `--json`, `--limit`                                                   | presentation; one; ambiguity fails; none                          |
| `settings set` / `settings.set`   | 1      | `--width?: Length`; `--height?: Length`; `--orientation?: portrait / landscape`; `--loop?: boolean`; `--show-type?: speaker / window / kiosk`; `--grid-spacing?: Length`; `--snap-to-grid?: boolean`; `--slide-number-start?: integer≥-9007199254740991≤9007199254740991` | `--json`, `--limit`, `--output`, `--in-place`, `--force`, `--dry-run` | presentation; one; ambiguity fails; package                       |

### A. masters

| Path / SDK ID                       | Inputs | Arguments (exact flags and types)    | Applicable options                                                                                                                | Scope; cardinality; publication                                     |
| ----------------------------------- | ------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `masters list` / `masters.list`     | 1      | none                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | masters; collection; omitted filter means all in scope; none        |
| `masters get` / `masters.get`       | 1      | none                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | masters; one; ambiguity fails; none                                 |
| `masters set` / `masters.set`       | 1      | `--name?: string`; `--text?: string` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | masters; one unless explicit all; zero requires allowEmpty; package |
| `masters add` / `masters.add`       | 1      | `--name: string`; `--text?: string`  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | masters; operation-specific in format contract; package             |
| `masters remove` / `masters.remove` | 1      | none                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | masters; one unless explicit all; zero requires allowEmpty; package |

### A. layouts

| Path / SDK ID                       | Inputs | Arguments (exact flags and types)                                         | Applicable options                                                                                                                | Scope; cardinality; publication                                     |
| ----------------------------------- | ------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `layouts list` / `layouts.list`     | 1      | none                                                                      | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | layouts; collection; omitted filter means all in scope; none        |
| `layouts get` / `layouts.get`       | 1      | none                                                                      | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | layouts; one; ambiguity fails; none                                 |
| `layouts set` / `layouts.set`       | 1      | `--name?: string`; `--master?: string`; `--text?: string`                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | layouts; one unless explicit all; zero requires allowEmpty; package |
| `layouts add` / `layouts.add`       | 1      | `--name: string`; `--master: string`; `--text?: string`                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | layouts; operation-specific in format contract; package             |
| `layouts remove` / `layouts.remove` | 1      | none                                                                      | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | layouts; one unless explicit all; zero requires allowEmpty; package |
| `layouts apply` / `layouts.apply`   | 1      | `--layout: string`; `--placeholder-policy: type-index / reject-unmatched` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | layouts; operation-specific in format contract; package             |

### A. themes

| Path / SDK ID                     | Inputs | Arguments (exact flags and types)                                                                                                                                                                                                                                                     | Applicable options                                                                                                                | Scope; cardinality; publication                                    |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `themes list` / `themes.list`     | 1      | none                                                                                                                                                                                                                                                                                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | shared; collection; omitted filter means all in scope; none        |
| `themes get` / `themes.get`       | 1      | none                                                                                                                                                                                                                                                                                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | shared; one; ambiguity fails; none                                 |
| `themes set` / `themes.set`       | 1      | `--name?: string`; `--color-slot?: dk1 / lt1 / dk2 / lt2 / accent1 / accent2 / accent3 / accent4 / accent5 / accent6 / hlink / folHlink`; `--color?: Color`; `--font-slot?: majorLatin / minorLatin / majorEastAsia / minorEastAsia / majorComplex / minorComplex`; `--font?: string` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | shared; one unless explicit all; zero requires allowEmpty; package |
| `themes add` / `themes.add`       | 1      | `--name: string`; `--color-slot?: dk1 / lt1 / dk2 / lt2 / accent1 / accent2 / accent3 / accent4 / accent5 / accent6 / hlink / folHlink`; `--color?: Color`; `--font-slot?: majorLatin / minorLatin / majorEastAsia / minorEastAsia / majorComplex / minorComplex`; `--font?: string`  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | shared; operation-specific in format contract; package             |
| `themes remove` / `themes.remove` | 1      | none                                                                                                                                                                                                                                                                                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | shared; one unless explicit all; zero requires allowEmpty; package |

### A. backgrounds

| Path / SDK ID                           | Inputs | Arguments (exact flags and types)                                                                                           | Applicable options                                                                                                                | Scope; cardinality; publication                                    |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `backgrounds list` / `backgrounds.list` | 1      | none                                                                                                                        | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `backgrounds get` / `backgrounds.get`   | 1      | none                                                                                                                        | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; one; ambiguity fails; none                                 |
| `backgrounds set` / `backgrounds.set`   | 1      | `--kind?: solid / gradient / picture`; `--color?: Color`; `--stops?: GradientStop[]`; `--angle?: Degrees`; `--file?: Input` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. shapes

| Path / SDK ID                               | Inputs | Arguments (exact flags and types)                                                                                                                                                                                                                                                                       | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `shapes list` / `shapes.list`               | 1      | none                                                                                                                                                                                                                                                                                                    | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `shapes get` / `shapes.get`                 | 1      | none                                                                                                                                                                                                                                                                                                    | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; one; ambiguity fails; none                                 |
| `shapes set` / `shapes.set`                 | 1      | `--kind?: "text-box" / MSO_AUTO_SHAPE_TYPE`; `--name?: string`; `--text?: string`; `--left?: Length`; `--top?: Length`; `--width?: Length`; `--height?: Length`; `--rotation?: Degrees`; `--fill?: Color`; `--line-color?: Color`; `--line-width?: Length`; `--alt-text?: string`; `--locked?: boolean` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `shapes add` / `shapes.add`                 | 1      | `--kind: "text-box" / MSO_AUTO_SHAPE_TYPE`; `--name?: string`; `--text?: string`; `--left: Length`; `--top: Length`; `--width: Length`; `--height: Length`; `--rotation?: Degrees`; `--fill?: Color`; `--line-color?: Color`; `--line-width?: Length`; `--alt-text?: string`; `--locked?: boolean`      | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `shapes remove` / `shapes.remove`           | 1      | none                                                                                                                                                                                                                                                                                                    | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `shapes paths add` / `shapes.paths.add`     | 1      | `--vertices: EmuVertices`; `--close: boolean`                                                                                                                                                                                                                                                           | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `shapes paths set` / `shapes.paths.set`     | 1      | `--vertices: EmuVertices`; `--close: boolean`                                                                                                                                                                                                                                                           | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `shapes group` / `shapes.group`             | 1      | `--shapes: Location[]`; `--tolerance: Length`                                                                                                                                                                                                                                                           | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `shapes ungroup` / `shapes.ungroup`         | 1      | `--tolerance: Length`                                                                                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `shapes move` / `shapes.move`               | 1      | `--position: Position`                                                                                                                                                                                                                                                                                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `shapes align` / `shapes.align`             | 1      | `--alignment: left / center / right / top / middle / bottom`                                                                                                                                                                                                                                            | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `shapes distribute` / `shapes.distribute`   | 1      | `--axis: horizontal / vertical`                                                                                                                                                                                                                                                                         | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `shapes duplicate` / `shapes.duplicate`     | 1      | `--offset-x: Length`; `--offset-y: Length`                                                                                                                                                                                                                                                              | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `shapes effects set` / `shapes.effects.set` | 1      | `--shadow: boolean`; `--opacity: Ratio`; `--shadow-blur: Length`; `--shadow-color: Color`                                                                                                                                                                                                               | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. fields

| Path / SDK ID                     | Inputs | Arguments (exact flags and types)                                                                                              | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `fields list` / `fields.list`     | 1      | none                                                                                                                           | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `fields get` / `fields.get`       | 1      | none                                                                                                                           | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; one; ambiguity fails; none                                 |
| `fields set` / `fields.set`       | 1      | `--kind?: slide-number / date / footer / header`; `--text?: string`; `--update?: preserve / explicit`; `--timestamp?: UtcDate` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `fields add` / `fields.add`       | 1      | `--kind: slide-number / date / footer / header`; `--text?: string`; `--update?: preserve / explicit`; `--timestamp?: UtcDate`  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `fields remove` / `fields.remove` | 1      | none                                                                                                                           | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. connectors

| Path / SDK ID                             | Inputs | Arguments (exact flags and types)                                                                                                                                                                                                                                                             | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `connectors list` / `connectors.list`     | 1      | none                                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `connectors get` / `connectors.get`       | 1      | none                                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; one; ambiguity fails; none                                 |
| `connectors set` / `connectors.set`       | 1      | `--kind?: MSO_CONNECTOR_TYPE`; `--begin-x?: Length`; `--begin-y?: Length`; `--end-x?: Length`; `--end-y?: Length`; `--begin-target?: Location`; `--end-target?: Location`; `--site?: integer≥-9007199254740991≤9007199254740991`; `--detach-policy?: detach / remove`; `--line-color?: Color` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `connectors add` / `connectors.add`       | 1      | `--kind: MSO_CONNECTOR_TYPE`; `--begin-x: Length`; `--begin-y: Length`; `--end-x: Length`; `--end-y: Length`; `--begin-target?: Location`; `--end-target?: Location`; `--site?: integer≥-9007199254740991≤9007199254740991`; `--detach-policy?: detach / remove`; `--line-color?: Color`      | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `connectors remove` / `connectors.remove` | 1      | none                                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. tables

| Path / SDK ID                                     | Inputs | Arguments (exact flags and types)                                                                                                                                                                                                                                                                                                 | Applicable options                                                                                                                                     | Scope; cardinality; publication                                    |
| ------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `tables list` / `tables.list`                     | 1      | none                                                                                                                                                                                                                                                                                                                              | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `tables get` / `tables.get`                       | 1      | none                                                                                                                                                                                                                                                                                                                              | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`                                                                             | slides; one; ambiguity fails; none                                 |
| `tables set` / `tables.set`                       | 1      | `--rows?: integer≥1≤250000`; `--columns?: integer≥1≤250000`; `--text?: string`; `--data?: TableData`; `--left?: Length`; `--top?: Length`; `--width?: Length`; `--height?: Length`; `--style?: string`; `--fill?: Color`; `--border-color?: Color`; `--border-width?: Length`; `--row-height?: Length`; `--column-width?: Length` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `tables add` / `tables.add`                       | 1      | `--rows: integer≥1≤250000`; `--columns: integer≥1≤250000`; `--text?: string`; `--data?: TableData`; `--left: Length`; `--top: Length`; `--width: Length`; `--height: Length`; `--style?: string`; `--fill?: Color`; `--border-color?: Color`; `--border-width?: Length`; `--row-height?: Length`; `--column-width?: Length`       | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `tables remove` / `tables.remove`                 | 1      | none                                                                                                                                                                                                                                                                                                                              | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `tables merge` / `tables.merge`                   | 1      | `--from: string`; `--to: string`                                                                                                                                                                                                                                                                                                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `tables split` / `tables.split`                   | 1      | none                                                                                                                                                                                                                                                                                                                              | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `tables rows add` / `tables.rows.add`             | 1      | `--position: Position`; `--span-policy: expand / reject`                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `tables rows remove` / `tables.rows.remove`       | 1      | `--position: Position`; `--span-policy: shrink / reject`                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `tables columns add` / `tables.columns.add`       | 1      | `--position: Position`; `--span-policy: expand / reject`                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `tables columns remove` / `tables.columns.remove` | 1      | `--position: Position`; `--span-policy: shrink / reject`                                                                                                                                                                                                                                                                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--table`, `--cell`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. charts

| Path / SDK ID                       | Inputs | Arguments (exact flags and types)                                                                                                                                                               | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `charts list` / `charts.list`       | 1      | none                                                                                                                                                                                            | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `charts get` / `charts.get`         | 1      | none                                                                                                                                                                                            | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; one; ambiguity fails; none                                 |
| `charts set` / `charts.set`         | 1      | `--data?: ChartData`; `--style?: integer≥1≤48`; `--title?: string`; `--legend?: boolean`; `--left?: Length`; `--top?: Length`; `--width?: Length`; `--height?: Length`                          | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `charts add` / `charts.add`         | 1      | `--type: CreatableChartType`; `--data: ChartData`; `--style?: integer≥1≤48`; `--title?: string`; `--legend?: boolean`; `--left: Length`; `--top: Length`; `--width: Length`; `--height: Length` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `charts remove` / `charts.remove`   | 1      | none                                                                                                                                                                                            | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `charts replace` / `charts.replace` | 1      | `--data: ChartData`; `--workbook-policy: synchronize-simple / reject-complex`                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. equations

| Path / SDK ID                           | Inputs | Arguments (exact flags and types) | Applicable options                                                                              | Scope; cardinality; publication                                    |
| --------------------------------------- | ------ | --------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `equations list` / `equations.list`     | 1      | none                              | `--json`, `--limit`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `equations get` / `equations.get`       | 1      | none                              | `--json`, `--limit`                                                                             | slides; one; ambiguity fails; none                                 |
| `equations set` / `equations.set`       | 1      | `--file?: Input`                  | `--json`, `--limit`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `equations add` / `equations.add`       | 1      | `--file: Input`                   | `--json`, `--limit`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `equations remove` / `equations.remove` | 1      | none                              | `--json`, `--limit`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. media

| Path / SDK ID                     | Inputs | Arguments (exact flags and types)                                                                                                                                    | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| --------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `media list` / `media.list`       | 1      | none                                                                                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `media get` / `media.get`         | 1      | none                                                                                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; one; ambiguity fails; none                                 |
| `media set` / `media.set`         | 1      | `--file?: Input`; `--poster?: Input`; `--kind?: audio / video`; `--mime-type?: string`; `--left?: Length`; `--top?: Length`; `--width?: Length`; `--height?: Length` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `media add` / `media.add`         | 1      | `--file: Input`; `--poster?: Input`; `--kind: audio / video`; `--mime-type: string`; `--left: Length`; `--top: Length`; `--width: Length`; `--height: Length`        | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `media remove` / `media.remove`   | 1      | none                                                                                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `media replace` / `media.replace` | 1      | `--file: Input`; `--poster: Input`                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `media extract` / `media.extract` | 1      | none                                                                                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output-dir`, `--force`, `--allow-partial-output`                        | slides; operation-specific in format contract; output-directory    |

### A. transitions

| Path / SDK ID                               | Inputs | Arguments (exact flags and types)                                                                                                                                            | Applicable options                                                                                                                | Scope; cardinality; publication                                    |
| ------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `transitions list` / `transitions.list`     | 1      | none                                                                                                                                                                         | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `transitions get` / `transitions.get`       | 1      | none                                                                                                                                                                         | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; one; ambiguity fails; none                                 |
| `transitions set` / `transitions.set`       | 1      | `--kind?: cut / fade / push / wipe`; `--direction?: left / right / up / down`; `--duration?: Milliseconds`; `--advance-after?: Milliseconds`; `--advance-on-click?: boolean` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `transitions add` / `transitions.add`       | 1      | `--kind: cut / fade / push / wipe`; `--direction?: left / right / up / down`; `--duration?: Milliseconds`; `--advance-after?: Milliseconds`; `--advance-on-click?: boolean`  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `transitions remove` / `transitions.remove` | 1      | none                                                                                                                                                                         | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. animations

| Path / SDK ID                             | Inputs | Arguments (exact flags and types)                                                                                                                                                                                      | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `animations list` / `animations.list`     | 1      | none                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `animations get` / `animations.get`       | 1      | none                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; one; ambiguity fails; none                                 |
| `animations set` / `animations.set`       | 1      | `--kind?: appear / fade-in / fade-out / pulse`; `--trigger?: on-click / with-previous / after-previous`; `--duration?: Milliseconds`; `--delay?: Milliseconds`; `--target?: Location / {slide:Position, shape:string}` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `animations add` / `animations.add`       | 1      | `--kind: appear / fade-in / fade-out / pulse`; `--trigger: on-click / with-previous / after-previous`; `--duration?: Milliseconds`; `--delay?: Milliseconds`; `--target: Location / {slide:Position, shape:string}`    | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `animations remove` / `animations.remove` | 1      | none                                                                                                                                                                                                                   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. links

| Path / SDK ID                   | Inputs | Arguments (exact flags and types)                                                                        | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| ------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `links list` / `links.list`     | 1      | none                                                                                                     | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `links get` / `links.get`       | 1      | none                                                                                                     | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; one; ambiguity fails; none                                 |
| `links set` / `links.set`       | 1      | `--url?: string`; `--target-slide?: Position`; `--action?: url / slide / next / previous / first / last` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `links add` / `links.add`       | 1      | `--url?: string`; `--target-slide?: Position`; `--action?: url / slide / next / previous / first / last` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `links remove` / `links.remove` | 1      | none                                                                                                     | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. notes

| Path / SDK ID                   | Inputs | Arguments (exact flags and types) | Applicable options                                                                                                                | Scope; cardinality; publication                                   |
| ------------------------------- | ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `notes list` / `notes.list`     | 1      | none                              | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | notes; collection; omitted filter means all in scope; none        |
| `notes get` / `notes.get`       | 1      | none                              | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | notes; one; ambiguity fails; none                                 |
| `notes set` / `notes.set`       | 1      | `--text?: string`                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | notes; one unless explicit all; zero requires allowEmpty; package |
| `notes add` / `notes.add`       | 1      | `--text: string`                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | notes; operation-specific in format contract; package             |
| `notes remove` / `notes.remove` | 1      | none                              | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | notes; one unless explicit all; zero requires allowEmpty; package |

### A. comments

| Path / SDK ID                         | Inputs | Arguments (exact flags and types)                                                                    | Applicable options                                                                                                                | Scope; cardinality; publication                                    |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `comments list` / `comments.list`     | 1      | none                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `comments get` / `comments.get`       | 1      | none                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; one; ambiguity fails; none                                 |
| `comments set` / `comments.set`       | 1      | `--text?: string`; `--author?: string`; `--timestamp?: UtcDate`; `--left?: Length`; `--top?: Length` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `comments add` / `comments.add`       | 1      | `--text: string`; `--author: string`; `--timestamp: UtcDate`; `--left?: Length`; `--top?: Length`    | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `comments remove` / `comments.remove` | 1      | none                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. tags

| Path / SDK ID                 | Inputs | Arguments (exact flags and types)     | Applicable options                                                                                                                | Scope; cardinality; publication                                    |
| ----------------------------- | ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `tags list` / `tags.list`     | 1      | none                                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `tags get` / `tags.get`       | 1      | none                                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`                                                                             | slides; one; ambiguity fails; none                                 |
| `tags set` / `tags.set`       | 1      | `--name?: string`; `--value?: string` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `tags add` / `tags.add`       | 1      | `--name: string`; `--value: string`   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `tags remove` / `tags.remove` | 1      | none                                  | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. accessibility

| Path / SDK ID                               | Inputs | Arguments (exact flags and types)                                   | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| ------------------------------------------- | ------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `accessibility list` / `accessibility.list` | 1      | none                                                                | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `accessibility get` / `accessibility.get`   | 1      | none                                                                | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; one; ambiguity fails; none                                 |
| `accessibility set` / `accessibility.set`   | 1      | `--alt-text?: string`; `--decorative?: boolean`; `--title?: string` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |

### A. objects

| Path / SDK ID                         | Inputs | Arguments (exact flags and types)                                                                    | Applicable options                                                                                                                           | Scope; cardinality; publication                                    |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `objects list` / `objects.list`       | 1      | none                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; collection; omitted filter means all in scope; none        |
| `objects get` / `objects.get`         | 1      | none                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`                                                                             | slides; one; ambiguity fails; none                                 |
| `objects set` / `objects.set`         | 1      | `--file?: Input`; `--icon?: Input`; `--program-id?: string`; `--width?: Length`; `--height?: Length` | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `objects add` / `objects.add`         | 1      | `--file: Input`; `--icon?: Input`; `--program-id: string`; `--width?: Length`; `--height?: Length`   | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; operation-specific in format contract; package             |
| `objects remove` / `objects.remove`   | 1      | none                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | slides; one unless explicit all; zero requires allowEmpty; package |
| `objects extract` / `objects.extract` | 1      | none                                                                                                 | `--json`, `--limit`, `--select`, `--scope`, `--slide`, `--shape`, `--output-dir`, `--force`, `--allow-partial-output`                        | slides; operation-specific in format contract; output-directory    |

### A. relationships

| Path / SDK ID                                   | Inputs | Arguments (exact flags and types)                                               | Applicable options                                                                                                     | Scope; cardinality; publication                                          |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `relationships list` / `relationships.list`     | 1      | none                                                                            | `--json`, `--limit`, `--select`, `--scope`                                                                             | presentation; collection; omitted filter means all in scope; none        |
| `relationships get` / `relationships.get`       | 1      | none                                                                            | `--json`, `--limit`, `--select`, `--scope`                                                                             | presentation; one; ambiguity fails; none                                 |
| `relationships set` / `relationships.set`       | 1      | `--id?: string`; `--type?: string`; `--target?: string`; `--external?: boolean` | `--json`, `--limit`, `--select`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; one unless explicit all; zero requires allowEmpty; package |
| `relationships add` / `relationships.add`       | 1      | `--id: string`; `--type: string`; `--target: string`; `--external: boolean`     | `--json`, `--limit`, `--select`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; operation-specific in format contract; package             |
| `relationships remove` / `relationships.remove` | 1      | none                                                                            | `--json`, `--limit`, `--select`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; one unless explicit all; zero requires allowEmpty; package |

### A. signatures

| Path / SDK ID                             | Inputs | Arguments (exact flags and types) | Applicable options                                                                                                     | Scope; cardinality; publication                                          |
| ----------------------------------------- | ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `signatures remove` / `signatures.remove` | 1      | `--all: true`                     | `--json`, `--limit`, `--select`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run`, `--all`, `--allow-empty` | presentation; one unless explicit all; zero requires allowEmpty; package |

### A. package

| Path / SDK ID                                             | Inputs | Arguments (exact flags and types) | Applicable options                                                                           | Scope; cardinality; publication             |
| --------------------------------------------------------- | ------ | --------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `package relationships set` / `package.relationships.set` | 1      | `--relationship: Relationship`    | `--json`, `--limit`, `--select`, `--scope`, `--output`, `--in-place`, `--force`, `--dry-run` | presentation; one; ambiguity fails; package |

## Appendix B. Creatable chart variants

The exact symbols are:

`AREA`, `AREA_STACKED`, `AREA_STACKED_100`, `BAR_CLUSTERED`, `BAR_STACKED`, `BAR_STACKED_100`, `BUBBLE`, `BUBBLE_THREE_D_EFFECT`, `COLUMN_CLUSTERED`, `COLUMN_STACKED`, `COLUMN_STACKED_100`, `DOUGHNUT`, `DOUGHNUT_EXPLODED`, `LINE`, `LINE_MARKERS`, `LINE_MARKERS_STACKED`, `LINE_MARKERS_STACKED_100`, `LINE_STACKED`, `LINE_STACKED_100`, `PIE`, `PIE_EXPLODED`, `RADAR`, `RADAR_FILLED`, `RADAR_MARKERS`, `XY_SCATTER`, `XY_SCATTER_LINES`, `XY_SCATTER_LINES_NO_MARKERS`, `XY_SCATTER_SMOOTH`, `XY_SCATTER_SMOOTH_NO_MARKERS`.

No other chart enum symbol is admitted by `charts add`.

## Appendix C. Wire schemas

These JSON Schema 2020-12 definitions are a readable projection of the operation
register. `$ref` resolves against that register; recursive references are bounded
by the limits in §7. The selected operation further constrains envelope `data`.
The model-operation union uses the exact registered argument/result fragments
and owner-checked handles; it is not an untyped SDK escape hatch.

### C. BatchData

```json
{
  "type": "object",
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/OfficeResultV1"
      },
      "maxItems": 250000
    },
    "outputs": {
      "$ref": "#/$defs/OutputManifest"
    }
  },
  "required": ["results", "outputs"],
  "additionalProperties": false
}
```

### C. Bytes

```json
{
  "type": "object",
  "properties": {
    "base64": {
      "type": "string",
      "maxLength": 1048576
    }
  },
  "required": ["base64"],
  "additionalProperties": false
}
```

### C. CapabilitiesData

```json
{
  "type": "object",
  "properties": {
    "features": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/FeatureCapability"
      },
      "minItems": 0,
      "maxItems": 250000
    },
    "host": {
      "type": "object",
      "properties": {
        "read": {
          "type": "boolean"
        },
        "write": {
          "type": "boolean"
        },
        "transaction": {
          "type": "boolean"
        },
        "fontMetrics": {
          "type": "boolean"
        }
      },
      "required": ["read", "write", "transaction", "fontMetrics"],
      "additionalProperties": false
    },
    "detected": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/FeatureCapability"
      },
      "minItems": 0,
      "maxItems": 250000
    },
    "unknown": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/Location"
      },
      "minItems": 0,
      "maxItems": 250000
    }
  },
  "required": ["features", "host", "detected", "unknown"],
  "additionalProperties": false
}
```

### C. ChartData

```json
{
  "type": "object",
  "properties": {
    "categories": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/Label"
      },
      "maxItems": 250000
    },
    "series": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/ChartSeries"
      },
      "maxItems": 250000,
      "minItems": 1
    }
  },
  "required": ["series"],
  "additionalProperties": false
}
```

### C. ChartSeries

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "maxLength": 1048576
    },
    "values": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "number"
          },
          {
            "type": "null"
          }
        ]
      },
      "maxItems": 250000,
      "minItems": 1
    },
    "xValues": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "maxItems": 250000,
      "minItems": 1
    },
    "bubbleSizes": {
      "type": "array",
      "items": {
        "type": "number",
        "minimum": 0
      },
      "maxItems": 250000,
      "minItems": 1
    },
    "numberFormat": {
      "type": "string",
      "maxLength": 1048576
    }
  },
  "required": ["name", "values"],
  "additionalProperties": false
}
```

### C. Color

```json
{
  "type": "string",
  "minLength": 6,
  "maxLength": 6,
  "description": "Exactly six hexadecimal digits; semantic validation required."
}
```

### C. CreatableChartType

```json
{
  "type": "string",
  "enum": [
    "AREA",
    "AREA_STACKED",
    "AREA_STACKED_100",
    "BAR_CLUSTERED",
    "BAR_STACKED",
    "BAR_STACKED_100",
    "BUBBLE",
    "BUBBLE_THREE_D_EFFECT",
    "COLUMN_CLUSTERED",
    "COLUMN_STACKED",
    "COLUMN_STACKED_100",
    "DOUGHNUT",
    "DOUGHNUT_EXPLODED",
    "LINE",
    "LINE_MARKERS",
    "LINE_MARKERS_STACKED",
    "LINE_MARKERS_STACKED_100",
    "LINE_STACKED",
    "LINE_STACKED_100",
    "PIE",
    "PIE_EXPLODED",
    "RADAR",
    "RADAR_FILLED",
    "RADAR_MARKERS",
    "XY_SCATTER",
    "XY_SCATTER_LINES",
    "XY_SCATTER_LINES_NO_MARKERS",
    "XY_SCATTER_SMOOTH",
    "XY_SCATTER_SMOOTH_NO_MARKERS"
  ]
}
```

### C. CropFraction

```json
{
  "type": "number",
  "minimum": -21474.83648,
  "maximum": 21474.83647
}
```

### C. Degrees

```json
{
  "type": "number",
  "minimum": -360000,
  "maximum": 360000
}
```

### C. DiffData

```json
{
  "type": "object",
  "properties": {
    "equal": {
      "type": "boolean"
    },
    "mode": {
      "enum": ["structural", "text", "media", "relationships", "effective-formatting", "raw"]
    },
    "changes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "kind": {
            "enum": ["added", "removed", "changed"]
          },
          "left": {
            "anyOf": [
              {
                "$ref": "#/$defs/Location"
              },
              {
                "type": "null"
              }
            ]
          },
          "right": {
            "anyOf": [
              {
                "$ref": "#/$defs/Location"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": ["kind", "left", "right"],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 250000
    }
  },
  "required": ["equal", "mode", "changes"],
  "additionalProperties": false
}
```

### C. DiscoveryData

```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": {
        "type": "array",
        "items": {
          "type": "string",
          "maxLength": 1048576,
          "minLength": 1
        },
        "minItems": 1,
        "maxItems": 250000
      },
      "minItems": 0,
      "maxItems": 250000
    },
    "schema": {
      "type": ["object", "null"],
      "description": "A JSON Schema 2020-12 document, validated against that dialect meta-schema; null only for help/version."
    },
    "text": {
      "type": "string",
      "maxLength": 1048576
    }
  },
  "required": ["paths", "schema", "text"],
  "additionalProperties": false
}
```

### C. Effect

```json
{
  "type": "object",
  "properties": {
    "location": {
      "$ref": "#/$defs/Location"
    },
    "action": {
      "enum": ["add", "set", "remove", "replace", "move", "retain"]
    },
    "feature": {
      "enum": [
        "F01",
        "F02",
        "F03",
        "F04",
        "F05",
        "F06",
        "F07",
        "F08",
        "F09",
        "F10",
        "F11",
        "F12",
        "F13",
        "F14",
        "F15",
        "F16",
        "F17",
        "F18",
        "F19",
        "F20",
        "F21",
        "F22",
        "F23",
        "F24",
        "F25",
        "F26",
        "F27",
        "F28",
        "F29",
        "F30",
        "F31",
        "F32",
        "F33",
        "F34",
        "F35",
        "F36",
        "F37",
        "F38",
        "F39",
        "F40",
        "F41",
        "F42",
        "F43",
        "F44",
        "F45",
        "F46",
        "F47",
        "F48",
        "F49",
        "F50",
        "F51",
        "F52",
        "F53",
        "F54",
        "F55",
        "F56",
        "F57",
        "F58",
        "F59",
        "F60"
      ]
    }
  },
  "required": ["location", "action", "feature"],
  "additionalProperties": false
}
```

### C. FeatureCapability

```json
{
  "type": "object",
  "properties": {
    "feature": {
      "enum": [
        "F01",
        "F02",
        "F03",
        "F04",
        "F05",
        "F06",
        "F07",
        "F08",
        "F09",
        "F10",
        "F11",
        "F12",
        "F13",
        "F14",
        "F15",
        "F16",
        "F17",
        "F18",
        "F19",
        "F20",
        "F21",
        "F22",
        "F23",
        "F24",
        "F25",
        "F26",
        "F27",
        "F28",
        "F29",
        "F30",
        "F31",
        "F32",
        "F33",
        "F34",
        "F35",
        "F36",
        "F37",
        "F38",
        "F39",
        "F40",
        "F41",
        "F42",
        "F43",
        "F44",
        "F45",
        "F46",
        "F47",
        "F48",
        "F49",
        "F50",
        "F51",
        "F52",
        "F53",
        "F54",
        "F55",
        "F56",
        "F57",
        "F58",
        "F59",
        "F60"
      ]
    },
    "subset": {
      "type": "string",
      "maxLength": 1048576,
      "minLength": 1
    },
    "level": {
      "enum": ["edit", "read", "preserve", "reject"]
    },
    "reason": {
      "type": "string",
      "maxLength": 1048576
    },
    "operations": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 1048576,
        "minLength": 1
      },
      "minItems": 0,
      "maxItems": 250000
    }
  },
  "required": ["feature", "subset", "level", "reason", "operations"],
  "additionalProperties": false
}
```

### C. FontMetrics

```json
{
  "type": "object",
  "properties": {
    "capabilityId": {
      "type": "string",
      "maxLength": 1048576
    }
  },
  "required": ["capabilityId"],
  "additionalProperties": false
}
```

### C. GradientStop

```json
{
  "type": "object",
  "properties": {
    "position": {
      "$ref": "#/$defs/Ratio"
    },
    "color": {
      "$ref": "#/$defs/Color"
    },
    "opacity": {
      "$ref": "#/$defs/Ratio"
    }
  },
  "required": ["position", "color"],
  "additionalProperties": false
}
```

### C. Handle

```json
{
  "type": "object",
  "properties": {
    "handle": {
      "type": "string",
      "maxLength": 1048576
    },
    "ownerFingerprint": {
      "type": "string",
      "maxLength": 1048576
    },
    "type": {
      "type": "string",
      "maxLength": 1048576
    }
  },
  "required": ["handle", "ownerFingerprint", "type"],
  "additionalProperties": false
}
```

### C. Input

```json
{
  "type": "object",
  "properties": {
    "vfsPath": {
      "type": "string",
      "maxLength": 1048576,
      "minLength": 1
    }
  },
  "required": ["vfsPath"],
  "additionalProperties": false
}
```

### C. Label

```json
{
  "anyOf": [
    {
      "type": "string",
      "maxLength": 1048576
    },
    {
      "type": "number"
    },
    {
      "$ref": "#/$defs/UtcDate"
    }
  ]
}
```

### C. Length

```json
{
  "type": "object",
  "properties": {
    "value": {
      "type": "number"
    },
    "unit": {
      "type": "string",
      "enum": ["emu", "in", "cm", "mm", "pt"]
    }
  },
  "required": ["value", "unit"],
  "additionalProperties": false
}
```

### C. Location

```json
{
  "type": "object",
  "properties": {
    "fingerprint": {
      "type": "string",
      "maxLength": 1048576,
      "minLength": 1
    },
    "scope": {
      "type": "string",
      "enum": [
        "slides",
        "notes",
        "layouts",
        "masters",
        "notes-master",
        "handout-master",
        "presentation",
        "shared"
      ]
    },
    "owner": {
      "type": "string",
      "maxLength": 1048576,
      "minLength": 1
    },
    "objectId": {
      "type": "string",
      "maxLength": 1048576,
      "minLength": 1
    },
    "coordinateSystem": {
      "type": "string",
      "enum": ["identity"]
    }
  },
  "required": ["fingerprint", "scope", "owner", "objectId", "coordinateSystem"],
  "additionalProperties": false
}
```

### C. Milliseconds

```json
{
  "type": "integer",
  "minimum": 0,
  "maximum": 2147483647
}
```

### C. MutationData

```json
{
  "type": "object",
  "properties": {
    "effects": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/Effect"
      },
      "minItems": 0,
      "maxItems": 250000
    },
    "outputs": {
      "$ref": "#/$defs/OutputManifest"
    },
    "fingerprint": {
      "type": ["string", "null"]
    }
  },
  "required": ["effects", "outputs", "fingerprint"],
  "additionalProperties": false
}
```

### C. OutputManifest

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "maxLength": 1048576
      },
      "sha256": {
        "type": "string",
        "maxLength": 1048576
      },
      "bytes": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      }
    },
    "required": ["path", "sha256", "bytes"],
    "additionalProperties": false
  },
  "maxItems": 250000
}
```

### C. Position

```json
{
  "type": "integer",
  "minimum": 1
}
```

### C. PropertyValue

```json
{
  "anyOf": [
    {
      "type": "string",
      "maxLength": 1048576
    },
    {
      "type": "number"
    },
    {
      "type": "boolean"
    },
    {
      "$ref": "#/$defs/UtcDate"
    }
  ]
}
```

### C. QName

```json
{
  "type": "object",
  "properties": {
    "namespace": {
      "type": "string",
      "maxLength": 1048576
    },
    "localName": {
      "type": "string",
      "maxLength": 1048576
    }
  },
  "required": ["namespace", "localName"],
  "additionalProperties": false
}
```

### C. Ratio

```json
{
  "type": "number",
  "minimum": 0,
  "maximum": 1
}
```

### C. Relationship

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "maxLength": 1048576
    },
    "type": {
      "type": "string",
      "maxLength": 1048576
    },
    "target": {
      "type": "string",
      "maxLength": 1048576
    },
    "external": {
      "type": "boolean"
    }
  },
  "required": ["id", "type", "target", "external"],
  "additionalProperties": false
}
```

### C. ResourceData

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/ResourceRecord"
      },
      "minItems": 0,
      "maxItems": 250000
    }
  },
  "required": ["items"],
  "additionalProperties": false
}
```

### C. ResourceRecord

```json
{
  "type": "object",
  "properties": {
    "location": {
      "$ref": "#/$defs/Location"
    },
    "kind": {
      "type": "string",
      "maxLength": 1048576,
      "minLength": 1
    },
    "name": {
      "type": ["string", "null"]
    },
    "fields": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 1048576,
            "minLength": 1
          },
          "value": {
            "$ref": "#/$defs/WireValue"
          }
        },
        "required": ["name", "value"],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 250000
    }
  },
  "required": ["location", "kind", "name", "fields"],
  "additionalProperties": false
}
```

### C. TableData

```json
{
  "type": "array",
  "items": {
    "type": "array",
    "items": {
      "type": "string",
      "maxLength": 1048576
    },
    "maxItems": 250000
  },
  "maxItems": 250000
}
```

### C. TextData

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "maxLength": 1048576
    },
    "segments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "location": {
            "$ref": "#/$defs/Location"
          },
          "text": {
            "type": "string",
            "maxLength": 1048576
          }
        },
        "required": ["location", "text"],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 250000
    }
  },
  "required": ["text", "segments"],
  "additionalProperties": false
}
```

### C. UtcDate

```json
{
  "type": "string",
  "format": "date-time",
  "description": "Explicit UTC Z; valid date; whole seconds on serialization."
}
```

### C. ValidationData

```json
{
  "type": "object",
  "properties": {
    "valid": {
      "type": "boolean"
    },
    "profile": {
      "enum": ["default", "strict"]
    },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 1048576,
            "minLength": 1
          },
          "status": {
            "enum": ["pass", "fail", "not-checked"]
          }
        },
        "required": ["name", "status"],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 250000
    }
  },
  "required": ["valid", "profile", "checks"],
  "additionalProperties": false
}
```

### C. VersionData

```json
{
  "type": "object",
  "properties": {
    "name": {
      "const": "pptx"
    },
    "version": {
      "type": "string",
      "maxLength": 1048576,
      "minLength": 1
    },
    "schemaVersion": {
      "const": 1
    }
  },
  "required": ["name", "version", "schemaVersion"],
  "additionalProperties": false
}
```

### C. Vertex

```json
{
  "type": "object",
  "properties": {
    "x": {
      "type": "number"
    },
    "y": {
      "type": "number"
    }
  },
  "required": ["x", "y"],
  "additionalProperties": false
}
```

### C. Vertices

```json
{
  "type": "array",
  "items": {
    "$ref": "#/$defs/Vertex"
  },
  "maxItems": 250000
}
```

### C. WireValue

```json
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "string"
        },
        "value": {
          "type": "string",
          "maxLength": 1048576
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "number"
        },
        "value": {
          "type": "number"
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "boolean"
        },
        "value": {
          "type": "boolean"
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "null"
        },
        "value": {
          "type": "null"
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "length"
        },
        "value": {
          "$ref": "#/$defs/Length"
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "date"
        },
        "value": {
          "$ref": "#/$defs/UtcDate"
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "bytes"
        },
        "value": {
          "$ref": "#/$defs/Bytes"
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "location"
        },
        "value": {
          "$ref": "#/$defs/Location"
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "handle"
        },
        "value": {
          "$ref": "#/$defs/Handle"
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "type": {
          "const": "list"
        },
        "value": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/WireValue"
          },
          "minItems": 0,
          "maxItems": 250000
        }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    }
  ]
}
```

### C. XmlData

```json
{
  "type": "object",
  "properties": {
    "part": {
      "type": "string",
      "maxLength": 1048576,
      "minLength": 1
    },
    "xml": {
      "type": "string",
      "maxLength": 1048576
    }
  },
  "required": ["part", "xml"],
  "additionalProperties": false
}
```

### C. XmlNode

```json
{
  "type": "object",
  "properties": {
    "name": {
      "$ref": "#/$defs/QName"
    },
    "attributes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "$ref": "#/$defs/QName"
          },
          "value": {
            "type": "string",
            "maxLength": 1048576
          }
        },
        "required": ["name", "value"],
        "additionalProperties": false
      },
      "maxItems": 250000
    },
    "text": {
      "type": "string",
      "maxLength": 1048576
    },
    "children": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/XmlNode"
      },
      "maxItems": 250000
    }
  },
  "required": ["name"],
  "additionalProperties": false
}
```

The complete enum definitions are the immutable `$defs` symbols linked by each
argument. `OfficeResultV1`, `BatchEnvelope` and `BatchItem` are the exact closed
register definitions; every union tag is a literal registered SDK operation ID.
Their recursive data references do not permit unknown operations or arbitrary
method/property evaluation.

### C. EmuVertex

```json
{
  "type": "object",
  "properties": {
    "x": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "y": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    }
  },
  "required": ["x", "y"],
  "additionalProperties": false
}
```

### C. EmuVertices

```json
{
  "type": "array",
  "items": {
    "$ref": "#/$defs/EmuVertex"
  },
  "maxItems": 250000,
  "minItems": 2
}
```

### C. PlaceholderText

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "type",
    "text"
  ],
  "properties": {
    "type": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1048576
    },
    "index": {
      "type": "integer",
      "minimum": 0,
      "maximum": 4294967295
    },
    "text": {
      "type": "string",
      "maxLength": 1048576
    }
  }
}
```
