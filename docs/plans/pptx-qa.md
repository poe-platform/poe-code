# pptx agent-executed fidelity QA

Status: Procedure drafted; product QA, rendering, playback and regression execution
not run. This document is a procedure for an agent, never a QA runner script.
The documentation task that creates it must not execute the whole pipeline.

## Authority and entry gate

Read root and applicable scoped AGENTS.md, the [format contract](../specs/pptx.md),
[shared CLI contract](../specs/office-cli.md) and
[shared SDK contract](../specs/office-sdk.md) before each campaign. Keep all
procedures and campaign execution logs in `docs/plans`; concise durable research
receipts and draft usage documentation may live in `docs/pptx`. Do not edit README.
Use exactly `pptx` for the utility name.

1. Record the implementation commit, dirty owned paths, operation/schema versions,
   adapter capabilities and campaign identifier. Preserve unrelated work. Confirm
   the public CLI and SDK entry points exist before attempting their operations.
   If unavailable, record `blocked-product-not-implemented`; do not substitute a
   reference program or mark a static design as passing product evidence.
2. Read the [test audit](../pptx/upstream-test-audit.md),
   [test inventory](../pptx/upstream-test-inventory.json),
   [case ledger](../pptx/test-case-map.json),
   [API audit](../pptx/upstream-api-audit.md),
   [API inventory](../pptx/upstream-api-inventory.json),
   [target API register](../pptx/public-api-map.json),
   [language mappings](../pptx/api-language-mappings.md) and
   [operation register](../pptx/command-coverage.json).
3. Read the [corpus manifest](../pptx/corpus-manifest.json). Resolve selected files
   by their exact `cache_path` and SHA-256, not basename guesses or directory scans.
   Recheck bytes/hash and rights/retention records before use. Missing or changed
   bytes block that fixture. Acquisition, if separately authorized, follows the
   existing acquisition plans; never download from a unit test or product operation.
4. Allocate an owned disposable workspace beneath the ignored cache and enumerate
   its exact inputs, copies, renders, extracted resources and application saves in
   the campaign log. Verify ignore rules. Keep manifest-listed originals immutable;
   every edit starts from a fresh copy. Native applications/renderers are explicit
   external QA tools only. Product execution gets explicit bytes/VFS, font metrics,
   time, limits and cancellation; no ambient host I/O, native runtime or network.
5. Check rights before sharing any render or extracted asset. Public download is
   not redistribution permission. Do not package, commit or publish corpus bytes.
   No source text, publisher imagery or default template is a permanent regression
   asset. Retain required [MIT notice](../pptx/upstream-license-notice.txt) separately
   for substantial derived material. Reference identities, links and attributions
   belong only in plans/research and required standalone legal notices, never in
   product names, source/comments, tests, fixtures, identifiers or CLI output.

## Coverage accounting before closure

At the inspected baseline the inventory contains 2,700 unit variants and 973
expanded BDD scenarios/examples. The ledger has 3,673 corresponding rows, plus
391 shared-package obligations; its 167 reviewed designs and 894 provisional
original designs are not executed tests. Another 2,611 rows require semantic
review and one public behavior is deferred. The API inventory has 2,407 records;
the target register has 2,424 rows, including 17 added bounded-view members.
These counts describe mixed research records, not an API completeness percentage.
Recompute them from the current inputs and record hashes on each campaign.

- Join every unit identity and every BDD file/line/example identity to its ledger
  row. Require an original TypeScript arrange/action/expected case for each
  relevant parameter binding, boundary value, exception and expanded example.
  A family-level checkmark or scenario-outline title does not cover its variants.
  Keep provenance links in research; executable case names and assets are original.
- Review each assertion and fixture dependency. Replace private delegation/mock
  topology with observable state, ownership, bytes, errors or publication behavior.
  Many-to-one mappings need explicit equivalence for every participating row.
  Architecture-only dispositions need evidence; unsupported public behavior stays
  a visible gap and blocks parity, even if all currently implemented tests pass.
- Join all API records to target signatures, defaults, getter/setter effects,
  errors, CLI or typed-batch route and independent original tests. Include inherited
  members, constructors, returned types, underscore-prefixed public interfaces,
  enums/aliases, collections, helpers and members with no upstream test candidate.
  Compare declarations, help, schema and capabilities with the registers. Never
  classify an API as private just because its type starts with an underscore.
- Apply the exact J01–J10 mappings below. Consult recorded drift resolutions and
  source evidence rather than reproducing prose errors. A new contradiction must
  have a research disposition, a precise original expected result and a linked
  regression obligation before documentation reconciliation is complete.
- Keep `specified`, `implemented`, `failed`, `passed`, `blocked`, `unsupported` and
  `not-run` distinct. Existing reference passes, corpus census and this procedure
  supply no TypeScript execution evidence. APIs without passing evidence remain
  open. Do not close outstanding implementation work in a documentation-only task.

| Mapping              | Required original acceptance evidence                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J01 names/arguments  | Neutral snake_case model names and positional order; only keyword-only arguments become trailing typed options with retained names. `default` positional binding becomes `default_value`; absent/undefined uses defaults, nullable null remains explicit absence. Operation JSON uses camelCase.                                                                                                   |
| J02 ownership        | Direct properties and assignment, creating lazy getters, read-only assignment errors, live owner-bound handles, readonly membership snapshots with live elements, cross-owner rejection and deterministic placeholder-handle invalidation. CLI reads must not invoke creating getters.                                                                                                             |
| J03 collections      | Checked zero-based lookup, length/iteration; sparse slide placeholder idx keys in ascending order; table rows/columns/cells and chart points reject negative positions. Only registered collections support at/slice; slices normalize bounds and require a nonzero integer step. Include includes/reversed/count/index/equals where declared.                                                     |
| J04 enums            | Immutable typed symbols, values, aliases and bounded XML conversion helpers; unsupported creation values remain inspectable. `PERCENT_40` is 6/`pct40`, `SLIDE_IMAGE` exists, and enum XML metadata is immutable. No typo alias or invented audio value.                                                                                                                                           |
| J05 values           | Safe integer EMU value objects; round halfway away from zero once; centipoints accessor floors division by 127. 12.5 centipoints → 1,588 EMU, 2.53 cm → 910,800, 9,144.9 EMU → 9,145. RGB requires exactly six hex digits and integer channels 0..255. Preserve true/false/null, negative valid crops, empty strings, UTC whole-second dates and explicit revision.                                |
| J06 async/bytes      | Factory, save and image/movie/OLE admission always return Promises; chart/table creation and in-memory replacement stay synchronous. Uint8Array/Date results are copies. Paths need explicit VFS authority; admission precedes visible mutation. SHA-1 image metadata is not SHA-256 fixture integrity.                                                                                            |
| J07 supplied context | Original empty default deck/assets, no implicit author or timestamp. fit_text uses admitted metrics (font_file is a metrics handle), never host font lookup; missing matching metrics fails. No link fetch, object activation, transcoding or movie-frame extraction.                                                                                                                              |
| J08 errors           | ValueError/invalid-value, TypeError/invalid-type, IndexError/index-out-of-range, KeyError/missing-key, PropertyAccessError/property-unavailable or read-only-property, InvalidHandleError/invalid-handle, OfficeError/unsupported-edit, PackageNotFoundError/io-failure, InvalidXmlError/invalid-xml. Native null/number member access is not an SDK coded error; narrow Length/number/null first. |
| J09 views            | Public element/part and parent remain bounded owner-aware XML/package views with validated graph edits, never unrestricted XPath, callbacks, host objects or dependency-runtime emulation. Test every added view member.                                                                                                                                                                           |
| J10 operations       | Whole text setters/clear retain destructive scope and required empty paragraphs; literal text replace preserves unrelated formatting. Every public behavior has a direct command or closed typed batch route, with no arbitrary method dispatch.                                                                                                                                                   |

Recheck resolved drift explicitly: chart insertion returns GraphicFrame; movie
insertion returns Movie; follow_master_background has a required setter; freeform
closure uses add_line_segments with close=true rather than a fictitious close
method; cell coordinates come from traversal rather than row_idx/col_idx fields.
Absent RGB raises PropertyAccessError; existing nonscheme theme color returns
NOT_THEME_COLOR and absent color raises; absent FillFormat.type is null. Notes
placeholder lookup returns NotesSlidePlaceholder or the explicitly typed fallback.
Keep the independent crossed value/series-label regression in the case ledger;
one flag's BDD assertion cannot prove the other's behavior. Published/source version
and module-path drift recorded in the audit is research, not product-version proof.

## Admission profiles and measurement

Run every selected fixture first under the format defaults. Record each effective
ceiling and trusted host ceiling, not merely a profile label. Defaults are 256 MiB
compressed input, 1 GiB expanded bytes, 50,000 entries, 32 MiB XML/part, depth 256,
5,000,000 XML nodes/operation, 5,000 slides, 250,000 selected-graph shapes, 256 MiB
individual media, 100 megapixels if decoding is introduced, 512 MiB output and
1,000 batch operations. One MiB is 1,048,576 bytes.

The selected large-media fixture has 457,525,505 input bytes and a 453,608,531-byte
media part in the manifest. Expect default `resource-limit`, ordinary exit 4,
zero affected objects and no publication. Record the actual first limiting
resource; do not assume all checks run after an early rejection. Then run a
separate trusted `large-media-512MiB` campaign with input and individual-media
ceilings of 536,870,912 bytes, other ceilings unchanged. Raising command limits
cannot exceed host authority. This is a proposed product QA profile, distinct
from manifest acquisition/census profiles, and is not evidence of acceptance yet.

Use tiny original boundary cases for exact-limit and one-over-limit checks,
combined diff/merge/batch accounting, cancellation during traversal/serialization
and publication failure. Measure actual decompressed reads and output, not just
ZIP declarations. Record elapsed time, peak memory, cancellation responsiveness,
platform and host budget for the large run; one run is not a benchmark guarantee.
Never enlarge the default profile simply to make a downloaded fixture pass.

## Deterministic fixture selection and mutations

Select the eight manifest paths below. All slide numbers refer to presentation
order, never filename sorting. Before each mutation resolve its target from the
baseline, record slide ID, owner part, shape ID/path and input fingerprint. For
“first” targets, order slides by presentation list, shapes depth-first by XML
order, and paragraphs/runs by their owner order; do not use rendered position.
If the required target is absent or unsupported, record a blocked case, not an
ad hoc substitute. Census counts are selection leads, not verified feature support.

Run each listed mutation independently from the immutable baseline, then repeat
with identical bytes/context to check deterministic output. Obtain fresh tokens
for outputs. Freeze the permitted part/node/resource changes before editing;
inspect the reported effects and reject any unexplained widening afterward.

Universal invariant U: all decoded entries outside the declared mutation closure
retain exact SHA-256 and bytes, including unknown/MCE extensions, media, notes,
masters, layouts, themes, workbooks and external relationships. Within a changed
XML part, unrelated nodes, attributes, namespace meaning, whitespace, IDs and
references remain intact. ZIP container bytes may differ. Slides not explicitly
selected retain IDs, order, render and associated notes/resources. A no-op should
return original package bytes; still check every entry if it reserializes.

| Fixture (relative to `.cache/pptx-corpus/`)               | Deterministic edits on independent copies                                                                                                                                                                                                                                                             | Expected unchanged slides/resources                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IXPE-Presentation-Template.pptx` (5 slides)              | Populate the first nonempty slide-local text paragraph by replacing its first Unicode scalar with `Q`, literal first-match within that owner. Separately create a deck from this template and append one slide using its first layout.                                                                | Text case: every slide except the resolved target, all notes and all resource parts obey U; only the replaced span inherits its first run style. Template case: original slides 1–5 and their dependency closures remain unchanged; only appended slide/required relationships and presentation bookkeeping may change.                                             |
| `SEWP_CH_Training_Presentation_05_12_25.pptx` (30 slides) | Replace the first picture occurrence with an original 16×16 opaque blue PNG, preserving box/crop/transform; do not use shared mode. Separately set the first unmerged cell in the first table to `QA cell`.                                                                                           | Picture case: every other occurrence, including any sharing its media, retains original bytes/geometry; all non-target slides remain unchanged. Table case: other cells and row/column sizes, spans/styles, picture/timing/MCE payloads remain unchanged. U applies to both.                                                                                        |
| `slides-public-engagement-DEC-2021.pptx` (28 slides)      | Set the first existing speaker-body notes text to `QA cue`. Separately set core title to `QA review`.                                                                                                                                                                                                 | Notes case: every slide's visual content/timing, all other notes and the selected notes slide-image/number placeholders and master remain unchanged. Title case: all 28 slides, notes, timing, connectors, groups and resources unchanged; only the core title node changes.                                                                                        |
| `20120418_Jedlovec_SuomiNPP.pptx` (36 slides)             | Set core title to `QA review`. Separately move presentation slide 2 to final position 1.                                                                                                                                                                                                              | Title case: all slides and all resource bytes unchanged. Move case: only presentation ordering/bookkeeping changes; slide identities and each slide's bytes, notes, OLE/embedded objects, media, timing targets and links remain attached to the same identities. Expected order is 2,1,3…36; U otherwise.                                                          |
| `earth-system-media-large.pptx` (1 slide)                 | Default-profile rejection first. Under the explicit large profile set existing speaker notes to `QA playback cue`; separately set core title to `QA review`.                                                                                                                                          | Rejection: all bytes/destinations unchanged. Notes case: slide 1, poster/video bytes, timing/trim/loop/volume and all other resources unchanged; only speaker body text changes. Title case: entire slide, notes and media graph unchanged. Verify playback independently.                                                                                          |
| `global-outlook-2026.pptx` (14 slides)                    | Replace the first Unicode scalar in the first nonempty slide-local paragraph with `Q`, scoped literal first-match. Separately set core title to `QA review`.                                                                                                                                          | Text case: all other slides, notes and image/relationship bytes unchanged; links and unaffected run styling in the edited paragraph remain intact. Title case: all 14 slides and every resource unchanged. External targets remain inert and unfetched.                                                                                                             |
| `data-visualization-course.pptx` (39 slides)              | Set first unmerged cell of first table to `QA cell`. Separately select the first chart with a simple supported workbook; increase its first finite y value by exactly 1 through chart-data replacement with synchronize-simple policy. If none qualifies, retain explicit unsupported-chart coverage. | Table case: other cells, layout and all chart/math/MCE/embedded resources unchanged. Chart case: only selected chart cache/formula ranges and its owned simple workbook cells may change; other charts and slides remain unchanged. Shared or complex workbook ownership must reject rather than widen effects. Preserve all unrelated workbook content; U applies. |
| `CluestotheCosmos.pptx` (8 slides)                        | Replace the first picture occurrence with the same original blue PNG, retaining geometry; separately set first existing speaker body to `QA cue`.                                                                                                                                                     | Picture case: other pictures, their bytes, all notes, all non-target slides and shared masters/layouts unchanged. Notes case: all eight rendered slides and media bytes unchanged; other notes and selected non-speaker placeholders unchanged.                                                                                                                     |

For the text recipe, a Unicode scalar is a complete code point, not half a
surrogate pair; pin its baseline span in disposable evidence without copying
publisher wording into durable test assets. If replacing `Q` with `Q`, record a
no-op and use an independent original deck for a visible text-change case.
The chart target is selected after inspecting actual ownership and workbook
structure, not by treating the count of chart XML parts as editable charts.

The remaining manifest entries are reserve fixtures, not silently counted as
executed. Record their paths as not selected and the reason (redundant initial
feature coverage); select them in a later scoped campaign if a finding requires
it. Missing Strict, complex-script, modern-comment, signature or animation-authoring
coverage must be supplied by original cases, not inferred from publisher metadata.

## Create, read and edit execution

1. Through both public SDK and safe-bash CLI, create an original deck without a
   template. Check zero slides, one original blank layout/master, size
   12192000×6858000 EMUs, Transitional/pptx kind, no synthesized author/time and
   deterministic bytes with identical context. Separately create explicit potx
   and ppsx kinds, explicit size and supplied timestamps. Reopen and validate kind.
2. Build an original three-slide control deck with split-run `Harbor draft`, a
   second occurrence of `draft`, a table/merge, two occurrences of one authored
   PNG on different slides, notes and an inherited text style. Use original assets.
   Exercise literal text replace (first/all/occurrence), whole text assignment,
   images list/replace/extract, tables set, properties set and template binding.
   Single image replacement changes one occurrence; explicit shared replacement
   changes exactly both. Extracted bytes match the source hash, not a rendered crop.
3. Read every selected fixture using inspect, text, images list, properties list,
   notes list, schema, capabilities and structural validate. Capture JSON and
   source hashes before/after. Reads/dry-runs must not create missing notes,
   titles, backgrounds or other parts. Inventory preserve/reject features explicitly.
4. Execute the fixture matrix through direct commands and matching SDK operations
   on separate copies. Use plural images/tables/properties and text replace;
   ordinary edits must work with direct flags and scoped selectors, without XML IDs
   or mandatory JSON. Test typed advanced batch operations through registered
   schemas/handles, not evaluation. Compare effects, normalized graphs and errors.
5. Test one-based CLI selectors versus zero-based SDK collections; stale tokens,
   ambiguous names, merged followers and missing selections; explicit notes/master/
   shared scope; `--all` cannot widen scope. Verify omitted/undefined/default values
   separately from null, false, zero and empty strings. Confirm negative crop and
   greater-than-one crop preserve valid positive visible extents without clamping.
6. Check help/schema/capabilities agree on supported subsets and signatures. Reject
   singular resource aliases, top-level replace, unknown/duplicate fields/options,
   conflicting cardinalities and inapplicable flags. Inspect CLI help/error
   screenshots using the maintained screenshot command when the entry point exists;
   keep these as ad hoc evidence, never screenshot unit tests.
7. Run focused safe-bash shell acceptance for spaces/Unicode, quoted text, `--`,
   pipes and one stdin consumer. Validate the eight-field version-1 JSON envelope,
   dotted operation IDs, camelCase options, deterministic ordering and stderr-only
   diagnostics. Binary stdout must contain only the fully staged package.
8. Check output/in-place/force/alias rules and dry-run with no publication. Inject
   stale input, cancellation and failing byte sinks through explicit adapters;
   prepublication failure preserves input and existing destination hashes. Test
   transactional multi-file extraction or explicitly declared partial-output
   manifests without deleting preexisting files. Ordinary statuses are 0 success,
   1 content/selection/unsupported failure, 2 usage/schema, 3 I/O, 4 limits, 130
   cancellation; diff is 0 equal, 1 different with ok=true, 2 trouble, 130 cancelled.

## Four independent evidence tracks

Record each track separately for baseline and every mutation. Use `pass`, `fail`,
`blocked`, `not-run` or a narrowly justified `not-applicable`; never aggregate them
into “valid deck” or use one track to excuse another.

| Track       | Agent actions and acceptance                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural  | Compare actual ZIP reads/CRC, part hashes/content types, presentation order/IDs, relationship targets/reachability, notes ownership, timing/connector/action references, chart caches/workbook ranges and unknown/MCE retention. Independently inspect changed parts with a bounded parser; product self-validation alone is insufficient. Record exact allowed changes and every unexpected delta.                   |
| Schema      | Record validator version, local schema editions/hashes, Strict/Transitional mode and extension/MCE coverage. Validate baseline and result independently with pinned schemas and external resolution disabled. Record unsupported namespaces and exact diagnostics. Baseline failures stay visible; “no new errors” is not a schema pass. CRC and well-formed XML are not schema validation.                           |
| Rendered    | Render current baseline and result in each available renderer using the controlled environment below. Inspect full-slide PNGs and difference images, all unchanged slides plus edited regions, notes pages and master-driven appearance. Cached thumbnails are not evidence. Cross-renderer agreement is supplemental, not the comparison baseline.                                                                   |
| Application | Open baseline and output separately in PowerPoint and an independent application such as LibreOffice, recording exact versions/platforms. Check repair prompts, editable content, notes associations, layout, slide order, hyperlinks as inert metadata and supported media/timing playback. Open without saving; any application re-save is a separately hashed derivative. Availability/codec gaps remain explicit. |

## Fonts, render comparison and playback

1. Record renderer/build, OS, slide dimensions, export resolution (start at 144 DPI),
   color profile, locale and font family/version/file hashes and substitution log.
   Install/use fonts only in the explicitly authorized QA environment. Font filenames
   and ambient discovery must not become product inputs; metrics are supplied
   explicitly. Missing/substituted fonts block a same-font fidelity claim.
2. Render each baseline twice before edits to measure renderer nondeterminism.
   Compare each result against its baseline in the same renderer/version/fonts;
   never use a PowerPoint baseline to demand pixel equality from LibreOffice.
   Compare dimensions, per-pixel absolute differences, differing-pixel fraction and
   bounding boxes. Keep side-by-side, overlay and heatmap views and inspect them.
3. Aim for zero changed pixels on unchanged slides under a stable renderer. Any
   nonzero difference requires explanation and an inspected region, even if a
   numeric similarity score is high. If repeated baseline renders vary, record
   the observed noise and freeze a justified tolerance/mask before assessing edits.
   Never mask text, object disappearance or layout changes as antialiasing noise.
4. On edited slides, outline the expected changed region before comparison; inspect
   it for intended content and all other regions for movement, clipping, wrapping,
   fallback images, crop, transparency and inherited styles. Notes-only/property-only
   changes should leave every slide render unchanged. Compare notes-page renders
   separately, including slide thumbnail, speaker body and page-number placeholders.
5. On the original control deck add original RTL/CJK/combining/emoji text with
   admitted fonts/metrics, font fallback metadata and known line breaks. Check
   fit_text with and without matching metrics and metadata-only autofit separately.
   Font/layout differences between applications do not change stored-text expectations.
6. For each selected fixture enumerate actual timing, transition, audio/video and
   caption targets and their slide IDs. In a playback-capable application capture
   baseline and output at the same ordered clicks, automatic advance events and
   recorded timestamps. Check trigger target/order, duration/delay, enter/exit/end
   state, poster, start/stop, audio presence, trim, looping, volume and captions when
   present. Do not execute external links, macros, OLE or run-program actions.
7. On an original tiny authored media/timing deck exercise cut/fade/push/wipe and
   appear/fade-in/fade-out/pulse, including explicit triggers and deterministic
   durations. Use a short original local audio/video clip with supplied poster.
   Complex/Morph timelines remain preservation cases; unsupported retarget/delete
   must reject unchanged. A renderer export cannot prove animation or playback.
8. A missing application, codec or playback capability is blocked/not-run for the
   affected check, not a pass. Inventory and byte retention can pass independently.
   If applications disagree, compare each output with its own baseline and inspect
   graph/schema evidence to isolate preexisting incompatibility versus edit damage.

## Findings, tiny regressions and closure

For every meaningful finding record a neutral finding ID, fixture SHA-256,
implementation/profile/tool versions, baseline and output hashes, exact operation
and selector, expected/observed result, evidence track and minimal reproduction.
Record structural defects, visual/notes/playback losses, false success, unexpected
rejections, performance/cancellation problems and documentation drift. Reproduce
against current code before proposing a fix. Unreproduced observations remain open.

Reduce each meaningful finding into a tiny original TypeScript unit regression
before closure: remove unrelated slides, parts and assets; rebuild essential
relationships with original XML/text/images/media; assert an independently known
result through the public API. Use in-memory bytes and memfs for file mutation,
no network, downloads, disk writes or LLM calls. Preserve relevant parameter
variants and boundary values; do not reproduce private mock plumbing. Retain
required standalone legal notices for substantial derived material.

### Reduction procedure and defect-preservation gate

Execute these steps only when product reproduction is authorized and available.
This documentation task specifies the procedure; it does not prove a failing
product test or a fix.

1. Freeze the failure predicate before reducing: the exact public operation,
   selected owner, expected result, observed violation and independent oracle.
   Record the implementation revision plus any owned patch hash, explicit context
   and limits. Reproduce on an immutable manifest input's disposable copy. A crash
   in setup, stale selector or unrelated validation error is not the same failure.
2. Isolate the smallest slide/part graph that still exhibits that predicate.
   Remove unrelated slides first, then unrelated shapes, paragraphs and parts,
   testing one change at a time against the same faulty implementation. Retain
   required presentation/content-type records, owner relationships and dependency
   closure: layouts/masters/themes, notes, shared media, chart workbooks and
   timing/connector targets where causal. Record why each remaining node/edge is
   needed. Refresh fingerprint-bound selectors for each candidate and verify that
   they still address the intended owner; record any ID remapping.
3. Record each trial's parent and candidate SHA-256, removed/replaced nodes or
   edges, graph counts, exact assertion and result. Accept a structural
   simplification only if the candidate reaches the same operation and fails the
   same predicate. If it passes, changes error category, fails admission first or
   becomes invalid for an unrelated reason, reject that candidate and retain the
   previous reproducer. Record the trial as defect-removing or inconclusive, never
   as evidence that the product was fixed. For an invalid-input finding, preserve
   the specific invalid condition without introducing a different one.
4. Rebuild the retained structure with original XML and replace every external
   text/media payload, including hidden notes, metadata, alt text, workbook labels,
   thumbnails, posters and embedded assets. Use authored text/images and generated
   local media; inert external targets use original reserved-domain values. Do not
   copy source templates, XML snippets, compressed payloads or reference identities
   into permanent fixtures. Preserve causal properties such as run boundaries,
   Unicode categories, resource sharing, relationship direction, namespace meaning,
   media dimensions and explicit timing values. Verify the predicate after each
   substitution. If substitution removes it, investigate that dependency and author
   an equivalent trigger; keep the finding open until an original reproducer exists.
5. Prove the original reproducer fails on the faulty revision using a permanent
   TypeScript unit test with an independently derived assertion. Keep fixture
   construction in memory; use memfs for VFS mutations. Record its test path,
   neutral case name, runner command, revision, fixture-builder hash and generated
   input hash. A placeholder expectation, skipped test, compilation failure or
   missing implementation is not red evidence. Where practical, add an original
   control that removes only the suspected trigger and passes on that revision.
6. In a separately authorized implementation task, fix the cause without weakening
   the frozen assertion or replacing its input. Run the identical regression on
   the fixed revision and record green evidence and the narrow maintained checks.
   Preserve relevant parameter/BDD variants and independent public API cases.
   Re-run the affected disposable fixture and external evidence tracks before
   closure. A green control or simplified deck alone cannot establish the fix.

“Smallest” means no further attempted safe removal retains the predicate within
the recorded reduction scope, not an unproved global minimum. For resource-limit
or performance findings, record the causal size/cardinality threshold; use a tiny
explicit-budget boundary case only when it exercises the same cause. Keep the
large-input performance/playback evidence separate when it cannot be represented
faithfully by a fast unit test.

| Candidate change   | Structural simplification if verified                                                       | Defect-removing change that cannot replace the regression                              |
| ------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Shared image graph | Remove unrelated slides while keeping two occurrences and their shared relationship target  | Give each occurrence a separate media part and thereby hide unintended shared mutation |
| Split text span    | Replace words with original text while keeping the matching span across styled runs         | Collapse the runs and stop exercising cross-run replacement                            |
| Notes/timing graph | Remove unrelated objects while preserving placeholder kinds, target IDs and dependent edges | Remove the affected placeholder/effect or flatten away the target relationship         |
| Extension payload  | Author neutral payload with the same namespace/branch/dependency structure                  | Strip the unknown branch whose preservation was failing                                |

### Permanent finding-to-test evidence

Keep one record per meaningful finding in the campaign Markdown under `docs/plans`.
The following fields are required for closure; use `not-run`, `blocked` or an
explicit absence reason while evidence is missing. Never fill missing results
with proposed commands or invented hashes.

| Field                   | Required evidence                                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and provenance | Neutral finding ID; manifest document pointer, immutable source SHA-256 and manifest hash; source/output artifact hashes and evidence-track receipts. Source names/links remain in this research record only.                                                    |
| Reproduction            | Faulty revision and owned patch hash, explicit profile/context, operation/selector, expected versus observed result, oracle and reproduction status.                                                                                                             |
| Reduction history       | Parent/candidate hashes, graph changes/counts, assertion result and accepted/rejected/inconclusive disposition for each trial; retained causal structure and original-content substitutions.                                                                     |
| Permanent regression    | Original unit-test path and case name, fixture-builder and generated-input hashes, precise assertion and parameter cases; no third-party asset dependency. Link the finding to all relevant case/API/feature obligations, including APIs with no upstream tests. |
| Red and green           | Same regression/input/assertion on faulty and fixed revisions; commands, exit statuses, exact failed assertion, passing result, fix commit and maintained-check receipts. Distinguish execution failures from assertion failures.                                |
| External verification   | Affected source fixture hash, output hash, renderer/application/profile versions and results; retain unresolved visual/playback/performance gaps explicitly.                                                                                                     |
| Rights and closure      | Original asset authorship, required standalone notice path where applicable, retained/disposable evidence locations and final open/closed disposition.                                                                                                           |

Every meaningful finding must join to at least one permanent regression before
closure; one regression may cover multiple findings only with an explicit causal
equivalence for each. Multiple tests for one finding list all required variants.
Keep source fixture hashes and provenance in research, not executable fixture
identifiers or test names. A documentation or census finding may have a proposed
case and a resolved documentation correction while product regression execution
remains `not-run`; neither status establishes a fixed product defect.

Examples of reductions are two slides sharing one image, one notes body plus a
slide-number placeholder, one table merge origin/follower, one chart and a tiny
owned data sheet, or one timing target and two dependent effects. A font/rendering
finding needs an original metrics/geometry/preservation regression for its cause,
then external screenshot verification of the fix. A codec-specific observation
must not be relabeled a product bug without reproduction. If the cause cannot yet
be reduced into a meaningful unit regression, keep the finding open.

Record the failing test before the code fix, passing test after it, test path,
commit and relevant maintained checks. Re-run the affected fixture/renderer and
application checks after the fix; a passing tiny test alone does not prove the
large-file symptom is gone. Documentation-only campaigns may specify a regression
but cannot mark it executed or close the finding. Attach each result to the case/API
ledger and support matrix; never claim whole-API/format parity with open public gaps.

## Cleanup and retained evidence

1. Close meaningful findings only after tiny original red/green regressions,
   maintained checks and affected external QA pass. Identify campaigns still using
   each fixture; preserve their inputs and evidence until they are finished.
2. Retain concise results, hashes, versions, profile values, unsupported/unrun cases,
   coverage/provenance links, legally required notices and original small tests.
   Keep restricted publisher screenshots private/disposable; durable evidence can
   describe findings and hash artifacts without redistributing publisher content.
3. Compare the enumerated owned paths with the manifest and campaign log. Recheck
   source hashes, ownership and active use before deleting only those individual
   downloads/copies/extractions/renders/application derivatives. Do not glob-delete
   the cache, delete a parent directory, follow symlinks outside it or remove other
   work. Update retention status without erasing historical provenance/measurements.
4. Verify the package file list excludes all QA inputs/outputs and inspect Git's
   explicitly staged paths. Never commit ignored fixtures or make tests acquire
   them. Use the narrow maintained checks for changed scope and the installed
   maintained Prettier check for owned Markdown/JSON, plus git diff --check.
5. Commit each atomic improvement on main using a Conventional Commit with only
   explicitly named owned files and relevant plan updates. No --no-verify,
   co-author, empty read-only commit or unrelated staging. Report local commits
   separately from delivery. This task authorizes no push, release or whole-pipeline
   execution; the procedure is not a release acceptance certificate.

## Documentation preparation evidence

This task consulted both test/API inventories, their audits and existing case/API/
command/language registers. Selected fixture paths and slide counts above come
from the manifest, not a fresh product inspection. No corpus edit/download,
renderer, application playback, product test, regression implementation or cleanup
was performed while drafting. Passed: installed maintained Prettier check, whitespace check, all 3,673 unique
case-ledger references, all 2,407 API IDs represented in 2,424 target rows, stated
ledger counts, eight selected manifest paths/slide counts and 13 local links.
The corpus cache is ignored; the owned plan is not. Some linked contracts/audit
inputs are preexisting untracked workspace files and are intentionally not staged
by this task; link checks establish local availability, not committed availability.
All future product execution steps above remain unrun.

### Reduction-procedure review receipt

Inspected documentation baseline: `cb6e8d947776dbf7d82d7fe3858793de5cb035a5`.
The existing reduction paragraph required red/green results but did not require
per-candidate defect preservation, rejected-trial evidence or an explicit
finding-to-test closure record. The added procedure supplies those gates without
claiming a product defect, executed regression or implementation fix.

Read-only accounting checks passed for all 3,673 unique inventory pointers and
matching unit/BDD identities, 2,407 API identities represented in 2,424 target and
obligation rows, all J01–J10 mapping keys, 14 unique manifest paths with SHA-256
syntax and 13 locally available links. The ledger still has 167 specified and
894 provisional designs, 2,611 rows needing semantic review and one deferred
public behavior; none is an executed TypeScript test. Input hashes for this review:

| Research input                 | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `upstream-test-inventory.json` | `702a7b6aaa2009050583c4ef4c2b363ef5f52bea4a59cc60aa5861e30731fa6d` |
| `test-case-map.json`           | `e9f113b5aee839dfe34353f2db726885eb0226bedb90798bb5718e133bd37706` |
| `upstream-api-inventory.json`  | `cd6467079c8f93d5be57758646f3fcd3667a6a13a1782fb371320c378803b934` |
| `public-api-map.json`          | `705907588d468a7711a8451a74a578ca24dc247e3bcbe88ea894bc099d2e0340` |
| `corpus-manifest.json`         | `f4c740aa929eb714b4b83ec63cb7d3641f278d5dffbc4c81303e02aee237169f` |

Passed: scoped maintained Prettier check, `git diff --check` and the write-spec
checker on the unchanged presentation specification (zero warnings). No product
or visual CLI behavior changed, so runtime tests and screenshots were not run.
No corpus bytes were read or modified; hash checks above identify research files,
not a fresh fixture-integrity verification. Existing untracked inputs and unrelated
edits remain outside this commit. All reduction execution and fix evidence remain
future work under the procedure's entry gate.
