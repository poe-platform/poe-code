# Disposable DOCX corpus audit

Current acquisition supplement, 2026-09-14: **23 real downloaded documents**
and **two separately counted original QA examples**. Four additions establish
actual insertion/deletion markup, Arabic RTL prose and Chinese Han prose. The
[gap report](corpus-feature-gaps.md) and [receipt](corpus-feature-gaps.json)
record remaining gaps, unsuccessful candidates, restrictions and authored
examples. The sections below retain the earlier **19-file audit snapshot**;
their zero counts and acquisition-pending statements describe that baseline.
Product qualification remains not run.

Reverified on 2026-09-14: **19 cached files, 142,217,570 compressed bytes,
238,710,812 expanded bytes and 655 stored media parts**. All source SHA-256
values, sizes, acquisition receipt fields and all 655 media hashes match.
No document was downloaded again, changed, rendered, activated or deleted.
The 569 globally unique media payloads are distinct from the sum of 597 per-file
unique payload counts. These are disposable QA inputs, never shipped assets or
canonical unit-test fixtures.

The [manifest](corpus-manifest.json) retains acquisition values and adds explicit
fresh classifications. The [audit receipt](corpus-audit-20260914.json) records
cache-artifact hashes, publisher reviews, independent structural evidence and
limits. The [owned task record](../plans/docx-corpus-audit.md) contains the QA
procedure and checks. Product read/edit/round-trip and rendering remain **not run**.

## Per-file classification

All 19 have actual Transitional WordprocessingML elements and zero Strict
WordprocessingML elements. Exact declared and used namespace URI sets are separate
in each manifest classification. `S/M` means simple fields / complex-field
markers, not a count of logical fields; begin/separate/end and instruction nodes
are recorded separately. `OMML` counts expressions, not equation paragraphs.
`C/R/E` means classic comment bodies / revision content-property-range nodes /
modern comment-extension records. The latter includes both ID and extensible
records and does not imply that classic comment bodies exist.

`Candidate` means within measured proposed default input ceilings; semantic
OPC/XML/reference/MCE admission and edit support remain unverified. `Limit` means
expected default `limit-exceeded` (ordinary CLI exit 4); the separate raised
census succeeded. Neither label is a product execution result.

| Fixture ID                                                         | Paragraphs | Tables | Media | S/M    | Sections | OMML | C/R/E   | Default   |
| ------------------------------------------------------------------ | ---------: | -----: | ----: | ------ | -------: | ---: | ------- | --------- |
| `circular-economy`                                                 |      2,657 |     56 |    43 | 17/273 |       30 |    0 | 0/0/0   | Candidate |
| `housing-supply-interim`                                           |      2,217 |     96 |    26 | 9/210  |       24 |    0 | 0/0/0   | Candidate |
| `gst-reforms-interim`                                              |      1,877 |     43 |    51 | 56/444 |       20 |    0 | 0/0/0   | Candidate |
| `gst-reforms-interim-appendixb`                                    |        228 |      6 |     0 | 12/45  |        2 |   59 | 0/0/0   | Candidate |
| `gst-reforms-interim-appendixc`                                    |      1,061 |     41 |     0 | 35/63  |        5 |    0 | 0/0/0   | Candidate |
| `gst-reforms-interim-appendixd`                                    |        312 |      4 |     9 | 1/6    |        2 |    0 | 0/0/0   | Candidate |
| `gst-reforms-interim-appendixe`                                    |        212 |      4 |     6 | 2/12   |        2 |    0 | 0/0/0   | Candidate |
| `gst-reforms-interim-sp1`                                          |        231 |      3 |    10 | 8/18   |        3 |    0 | 0/0/0   | Candidate |
| `ministry-for-the-environment-annual-report-2024-2025`             |      6,334 |    133 |    42 | 0/219  |       16 |    0 | 0/0/0   | Candidate |
| `our-atmosphere-and-climate-2023`                                  |        907 |      3 |    19 | 0/90   |        3 |    0 | 0/0/0   | Candidate |
| `scotland-annual-progress-report-2026-template-v1`                 |      1,406 |     57 |     0 | 0/396  |       23 |    0 | 0/0/0   | Candidate |
| `our-future-rm-system-developing-the-npf`                          |        709 |     26 |     5 | 0/102  |        4 |    0 | 0/0/0   | Candidate |
| `new-zealands-second-emissions-reduction-plan-discussion-document` |      2,225 |     68 |    45 | 0/429  |        6 |    0 | 0/0/0   | Candidate |
| `national-climate-change-risk-assessment-main-report`              |      3,227 |     40 |    15 | 0/321  |        9 |    0 | 0/0/254 | Candidate |
| `mental-health-review`                                             |      5,432 |    138 |    62 | 6/243  |       31 |    0 | 0/0/0   | Candidate |
| `nz-ghg-inventory-2025-vol-1`                                      |     15,172 |    208 |    86 | 0/1272 |       23 |   45 | 0/0/0   | Candidate |
| `nz-ghg-inventory-2025-vol-2`                                      |     46,916 |    189 |    41 | 0/860  |       20 |    4 | 0/0/0   | Limit     |
| `wales-race-equality-response-images`                              |        586 |     48 |    71 | 0/3    |        1 |    0 | 0/0/0   | Candidate |
| `wales-citizen-voice-easy-read`                                    |        400 |      0 |   124 | 0/3    |        1 |    0 | 0/0/0   | Candidate |

Counts cover all outer-package XML, including auxiliary stories, glossary and
unselected fallback content. Paragraph/table counts are not just document-body
objects. Media are stored resources, not rendered image occurrences. Section
properties are XML nodes, not measured pages. Every cached page value remains
labelled metadata; **zero rendered page measurements exist**.

## Corrections and verified structures

- The annex contains **three chart definitions**, plus three chart-style and
  three chart-color-style XML parts. The earlier `census.chart_parts = 9` counted
  all XML under `word/charts`. That historical field is preserved with its exact
  meaning; `audited_classification.counts.chart_definitions = 3` is the corrected
  interpretation. Nine charts must not be claimed from the historical report or
  pipeline wording.
- The climate-risk report contains 91 `commentExtensible` and 163 `commentId`
  records in two modern metadata parts, but no classic comment body, range or
  reference nodes. It also enables `trackRevisions` without containing recorded
  changes. Cross-reference validity of that orphan-looking metadata is unverified;
  it is a preservation/validation candidate, not a complete review fixture.
- There are **508 substantive footnote bodies and zero substantive endnote
  bodies**. Historical footnote/endnote counts include separators and settings
  references. The fresh counts distinguish actual bodies and separators under
  each notes-part root; settings references are not notes.
- The 108 OMML expressions occur in appendix B (59), inventory volume 1 (45)
  and volume 2 (4). There are 65 OMML paragraph containers and 4,873 OMML nodes.
- There are 146 simple fields, 5,009 complex-field markers and 1,729 instruction
  nodes. Marker balancing, nesting, instruction semantics and page-field
  recalculation have not been validated by these counts.
- The 172 controls include 31 explicit text, 37 checkbox and two date controls,
  98 document-part objects, three citations and one bibliography. There are 27
  data-binding declarations. These are structural counts, not proven binding or
  checkbox behavior. Two documents specify tracked-change protection with
  enforcement explicitly `0`; they are not active-protection examples.
- All 60 AlternateContent groups have a direct Fallback. Their Choice requirements
  resolve to extension namespaces outside core-v1 (drawing chart extension,
  wordprocessing group or shape); core-v1 therefore selects fallback. There are
  no observed MustUnderstand or ProcessContent attributes. Full MCE validation,
  reference checking and edit preservation remain pending.
- Nine files have shared image targets by owner-scoped relationship references;
  that census includes alternate branches and is not a visible occurrence count.
  There are no external image relationships or DrawingML linked blips. The 831
  external relationships are 816 hyperlinks, 13 attached templates and two OLE
  targets; none was followed. Six embedded objects remained opaque.

## Limits and expected outcomes

The historical inspection used 32 MiB per XML part, 512 MiB expanded, five million
nodes and depth 256. The annex's historical `XML size limit` result is retained
separately from its successful explicit **128 MiB XML / 512 MiB expanded /
five-million-node / depth-256** census. Its main XML is 40,415,536 bytes.
A fresh bounded read refused at the first 64 KiB chunk exceeding 32 MiB
(33,619,968 streamed bytes). This is a census rejection, not a malformed-document
finding or a run of the proposed product.

The [format specification](../specs/docx.md) proposes different product defaults:
64 MiB compressed, 256 MiB expanded, 10,000 ZIP entries, 32 MiB XML,
two million XML nodes, depth 256 and 64 MiB per media item. Eighteen files fit
those measured input ceilings. The annex exceeds only the individual XML ceiling;
its 1,226,106 nodes and 47,777,441 expanded bytes fit the other measured defaults.
Raising only the trusted XML ceiling would remove the observed input-size blocker,
but would not prove semantic admission or successful editing.

Across the corpus the maxima are 193 ZIP entries, depth 31 and an 8,209,994-byte
media item. Per-table observed maxima are 6,651 stored cells, 444 rows and 32 grid
columns; logical grid expansion and operation budgets were not measured. Retained
buffers, serialized output, CPU/work and mutation limits remain unqualified.
No profile is silently raised by an ordinary CLI option.

## Provenance and publisher restrictions

All documents are regular, non-symlink files with mode `0444`, under the ignored
`.cache/docx-corpus` directory. The source/final URL, retrieval timestamp, byte
count and hash agree with `download-results.json`; its hash and the selection,
discovery, probe and both census artifact hashes are retained in the audit receipt.
These are consistent local acquisition records, not independently signed HTTP
receipts. No current server-byte identity or new acquisition is claimed.

The two inventory URLs were inferred on the official publisher host because the
landing page exposed broken CMS shortcodes. Historical HTTP 200/type/size probe
records agree with the download receipts. The historical health-source HTTP 403
and failed 2024 inventory probe remain failures; neither was bypassed or retried.

| Publisher                          | Current primary-source review                                                                                                                                                                                                                                               | Restriction carried forward                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Australian Productivity Commission | [Copyright](https://www.pc.gov.au/copyright/) permits CC BY 4.0 reuse of agency material with attribution, including identifying adaptations.                                                                                                                               | Coat of arms, agency logo and third-party content excluded; no endorsement or blanket asset clearance.                                                       |
| NZ Ministry for the Environment    | [Copyright](https://environment.govt.nz/about-this-site/copyright/) applies CC BY 4.0 unless an item says otherwise.                                                                                                                                                        | Photography/imagery, logos, emblems, trademarks, design elements and third-party material excluded. Image reuse requires express permission.                 |
| Welsh Government                   | [Copyright](https://www.gov.wales/copyright-statement) links information reuse to OGL.                                                                                                                                                                                      | Logo permission required. The linked OGL page returned HTTP 403 during this review; no newly verified full OGL text or universal asset clearance is claimed. |
| Defra LAQM                         | [Template page](https://laqm.defra.gov.uk/air-quality/annual-reporting/annual-progress-report-templates-scotland/) has an OGL v3.0 footer, but [detailed terms](https://laqm.defra.gov.uk/terms/) restrict commercial copying/modification/distribution without permission. | Applicability conflict remains unresolved. Keep the template read-only for reference; no cleared mutation, redistribution or commercial reuse claim.         |

Fresh text inspection found license/copyright indicators consistent with the
retained acquisition evidence, including publication-specific notices and imagery
exceptions. Keyword matches alone do not grant rights; not every embedded asset's
rights holder has been resolved. No public report passages, images or binaries
were adapted, distributed or promoted into tests in this audit. Any future
publication of derived output still needs its applicable item/asset review.

## Exact remaining corpus gaps

| Area                           | Available evidence                                                                        | Missing evidence                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classic comments and revisions | 254 modern metadata records in one file; one tracking-enabled setting                     | Zero classic bodies/anchors/references, insertions, deletions, moves, property/range changes or other counted revision elements. No complete threaded conversation.                         |
| Notes                          | 508 substantive footnotes                                                                 | Zero substantive endnotes; separator-only parts do not cover endnote editing.                                                                                                               |
| Dialect and languages          | 19 Transitional inputs; language declarations recorded                                    | Zero Strict WordprocessingML elements. Zero RTL/Han/Kana/Hangul characters in inspected `w:t`, and zero `w:rtl`/`w:bidi` properties. Actual mixed-script layout/edit behavior absent.       |
| Images                         | PNG/JPEG/TIFF/EMF/WDP/SVG stored files; nine files with repeated image-target references  | No stored GIF/BMP/WMF; no external image relationship or linked blip. Orientation, DPI, malformed-header and SVG security variants not characterized.                                       |
| Controls                       | Checkbox/text/date controls and data-binding declarations                                 | Zero legacy `ffData`, explicit drop-down/combo-box/picture/repeating-section properties. Binding evaluation and lock behavior unverified.                                                   |
| Charts/diagrams                | Three chart definitions, six support XML parts, embedded objects                          | No diagram-directory parts; comprehensive chart types, chart/workbook binding validation and SmartArt behavior unqualified.                                                                 |
| MCE                            | 60 fallback groups; three extension requirement URIs                                      | No MustUnderstand/ProcessContent or missing-fallback rejection case; Strict/extension processing and unchanged-branch preservation tests pending.                                           |
| Protection/signatures          | Two disabled protection settings; no detected macro content types or signature-part names | No enforced editing protection, signed document, macro profile or verified ZIP64 boundary case. Valid/reject adversarial ZIP/XML cases absent.                                              |
| Large documents                | One file exceeds 20 MiB compressed; maximum expanded file is 47,777,441 bytes             | Only one meets the earlier 20-MiB-or-100-MiB-expanded size target; a second qualifying real input remains missing. Zero successful product round-trips or targeted edits under any profile. |
| Product and rendering          | Integrity/census only                                                                     | All create/read/edit, cancellation, failure atomicity, output hashes, public SDK/CLI, rendering and original regression outcomes remain pending.                                            |

The subsequent `fill-corpus-feature-gaps` acquisition is recorded in the
[gap report](corpus-feature-gaps.md). Its four real downloads and two original
examples are separate from this baseline audit. Generated inputs cannot increase
the real-download count, and acquisition does not establish product support.

## Shared command and SDK alignment

The [CLI](../specs/office-cli.md), [SDK](../specs/office-sdk.md) and current
[public API map](public-api-map.json) remain authoritative. Corpus evidence must
not create alternate commands: use `images`, `tables`, `properties`, `text replace`,
`schema` and `capabilities`, common selectors/flags and the versioned result/error
contract. Ordinary resource-limit rejection maps to exit 4; `diff` has its separate
0/equal, 1/different, 2/failure and 130/cancelled convention.

The exact per-member signatures and mappings are already recorded by the API map:
`Document(input?: Input | null, context?: DocumentContext): Promise<DocumentModel>`
and `save(output: ByteSink | VfsPath): Promise<void>` admit explicit capabilities;
input/image admission is always async, live model access synchronous. Model
snake_case remains distinct from camelCase operation arguments. Sequences are
zero-based with length/iteration/at and only documented slicing; keyed collections
retain keys while CLI selectors are one-based. Undefined applies declared defaults;
null is explicit absence, not false/zero. Unit factors are 914400/inch, 360000/cm,
36000/mm, 12700/point and 635/twip, using safe integer EMUs and halfway-away-from-zero
rounding. Dates are copied UTC instants serialized to whole seconds. Bytes are
owned copies; time/author/fonts/VFS are explicit; bounded owner views never grant
host I/O, external fetch, eval or arbitrary XPath. Typed enum aliases and neutral
type/value/bounds/key errors remain required. These are proposed mappings, not
observations proved by opening this corpus.

Documentation drift remains resolved as `comment_id`/`timestamp`, without `id`/
`date` aliases. Inherited, returned, enum, collection, helper and underscore-prefixed
public APIs stay in scope even without source tests or corpus examples. The current
register has 1,337 proposed rows derived from 920 inventoried IDs; the
[test crosswalk](test-case-map-notes.md) maps 2,259 source cases but implements none.
Historical acquisition labels saying unmapped do not override that later mapping
state. No API coverage or test pass follows from these documentary counts.

## Retention and reduction status

The files remain immutable disposable inputs while future campaigns need them.
Keep this manifest/evidence after cleanup. No product defect was reproduced and
no product code was changed, so this task authors zero regressions and closes no
product finding. Later meaningful findings require a failing small original memfs
test before implementation, then passing evidence and its permanent test path.
Original text/assets must replace report content; tests must not import this
research corpus or depend on its cache. Cleanup remains pending and must touch
only listed documents and explicitly owned outputs no active campaign needs.
