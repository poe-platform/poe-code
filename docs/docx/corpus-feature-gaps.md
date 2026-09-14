# DOCX corpus gap acquisition evidence

Status: structural research only, 2026-09-14. No product operations or canonical
unit tests have run. The [receipt and measurements](corpus-feature-gaps.json)
and [manifest](corpus-manifest.json) distinguish **23 downloaded documents**
from **two original authored QA examples**. The previous 19-file audit remains
an immutable historical baseline; the four new documents total 882,476 bytes.
See the [executed acquisition plan](../plans/docx-corpus-feature-gaps.md).

## Measured additions

Counts include auxiliary XML stories and all fallback branches. Notes count
normal root-child bodies, not separators or settings references. Script counts
come from actual `w:t` character data, not language declarations.

| ID                             | Publisher input                                                                                                                                                                      | Measured evidence                                                                                                                                                                   | Negative evidence                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `wa-outcome-standards-tracked` | [WA Outcome Standards comparison](https://www.wa.gov.au/government/publications/outcome-standards-registration-standards-2025)                                                       | 338,641 bytes; 518 paragraphs; 8 tables; 199 insertions and 345 deletions                                                                                                           | No classic comments, moves or property changes; no substantive notes                                       |
| `hk-values-story-teacher`      | [Hong Kong values education, teacher resource 1](https://www.edb.gov.hk/tc/curriculum-development/kla/pshe/references-and-resources/ethics-and-religious-studies/moral-stories.html) | 31,195 bytes; 113 paragraphs; 3,525 Han characters; 40 paragraphs with at least 20 Han characters                                                                                   | One document-part control, no interactive drop-down/legacy fields; separator-only notes                    |
| `un-mauritius-core-ar`         | [OHCHR HRI/CORE/MUS/2024, Arabic Word link](https://tbinternet.ohchr.org/_layouts/15/treatybodyexternal/Download.aspx?Lang=zh&symbolno=HRI%2FCORE%2FMUS%2F2024)                      | 123,678 bytes; 675 paragraphs; 18 tables; 56,373 RTL characters; 370 paragraphs with at least 20 RTL characters; 1,779 RTL properties, 31 bidi properties; one substantive footnote | No substantive endnotes, comments or revisions                                                             |
| `accessibility-review-prose`   | [Public accessibility review attachment](https://www.w3.org/WAI/EO/wiki/EOWG_Meetings_2022)                                                                                          | 388,962 bytes; 144 paragraphs; one embedded image                                                                                                                                   | “Comments” in the landing label denotes ordinary feedback prose: zero comment bodies, anchors or revisions |

All four use Transitional WordprocessingML elements. None contains external
image relationships, linked blips, shared image targets, legacy fields, explicit
drop-down/combo-box/picture/repeating-section controls or substantive endnotes.
There is no new chart-definition coverage. All four fit the measured census
limits, which does not establish semantic admission or editing fidelity.

## Publisher terms and acquisition failures

The manifest records exact source/final URLs, timestamps, SHA-256 and measured
structure. Source files are read-only and ignored. No downloaded text, image or
binary is copied into authored examples or canonical tests.

- [WA terms](https://www.wa.gov.au/terms-of-use) restrict commercial reproduction
  and reuse without permission or another applicable exception. Retain source
  acknowledgement and review third-party ownership. No commercial mutation or
  redistribution clearance is asserted.
- [Education Bureau notices](https://www.edb.gov.hk/en/important-notices/index.html)
  permit personal/non-commercial internal downloads of government material with
  the notice retained. The notice was downloaded in the same session. Other
  reproduction/adaptation/distribution and third-party works need separate
  authorization. The earlier guessed notice URL returned 404; it is recorded.
- The UN terms endpoint returned 403. The public official Word link establishes
  provenance, not license clearance. Rights remain unresolved; no redistribution
  or derivative publication is authorized by this evidence.
- [W3C copyright policy](https://www.w3.org/copyright/) allows notice-preserving
  copies and prohibits misleading modifications/endorsement. The downloaded
  general document license does not prove that every archived contributor asset
  is covered. Retain all notices and unresolved third-party rights.

The New Zealand fast-track comments landing page returned HTTP 403. The London
committee landing page also returned 403 through web research. The Australian
court forms landing transfer failed with an HTTP/2 transport error. No files
from these attempts count as acquired, and access controls were not bypassed.

Strict research reviewed the [Library of Congress format description](https://www.loc.gov/preservation/digital/formats/fdd/fdd000400.shtml)
and found the National Archives format record in search, but no downloadable
real-world Strict specimen. The latter page could not be opened in web research.
Linked-image searches found PDF renderings with missing-image text, not suitable
DOCX source packages. These are search outcomes, not proof that examples do not
exist. No linked image, attached template, external OLE target or other resource
inside a document was fetched; no object or field was activated.

## Original gap examples

The [authored part maps](gap-authored-examples.json) preserve the complete original
UTF-8 XML and one original diagnostic pixel. Only disposable packages were
assembled in the ignored cache. These are QA evidence data, not the later
canonical unit-fixture implementation. No external source code/test fixture was
copied, and no additional derived-material license notice is needed.

| Example                          | Verified structure                                                                                                                                                                                                            | Limits of evidence                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `authored-strict-language-note`  | 23 Strict WordprocessingML elements, zero Transitional elements; Strict office-document and endnotes relationship types; three paragraphs, one normal endnote; original Arabic/Japanese/Korean wording                        | Tiny authored structure, not a real-world Strict report, renderer result or full schema conformance certificate       |
| `authored-review-links-controls` | One classic body with matching start/end/reference ID 0; one insertion/deletion pair; one drop-down and one combo-box; one legacy text field; one external VML image target and two references to one internal original pixel | No modern threaded comments, move/property revisions, DrawingML linked blip, repeating controls or binding evaluation |

The external target is the reserved non-resolving example URL
`https://example.invalid/unfetched-pixel.png`; it was never requested. The original
pixel has no publisher branding or artistic content. UTF-8 part maps, normal
OPC relationships, hashes and counts are inspectable without an Office runtime.
A trial full WML XSD compilation failed on its unresolved `xml:space` import;
no remote schema resolution was attempted and no XSD pass is claimed. Bounded
XML/CRC and independent relationship checks are the actual evidence.

## Remaining real-world gaps and later acceptance

The existing baseline already supplies 508 footnotes, nine files with shared
image targets and 172 content controls, including text, checkbox and date
controls. The new Arabic report adds one footnote. The inventory annex still has
**nine chart-directory XML parts: three chart definitions and six style/color
parts**. Its original 32 MiB XML refusal and separate raised-profile census are
unchanged. This task does not reclassify that refusal as a successful product run.

Real-world classic comments, Strict markup, external linked graphics, substantive
endnotes, Kana/Hangul prose and legacy/drop-down/combo-box/picture/repeating
controls remain absent. Rich/threaded comments, move/property changes, SmartArt,
enforced protection/signatures, adversarial ZIP/XML and a second qualifying large
report remain unqualified. Authored examples close only the narrow structural
input gaps listed above. Product editing, round trips, rendering, resource
profiles, regression reduction and cleanup remain pending.

Later original tests must assert behavior with new in-memory assets, independently
of all downloaded documents:

- Preserve logical mixed-script text and original dialect across literal
  `text replace`; do not reshape Unicode into visual order.
- List/anchor/remove a comment by its ID and selected story; reject dangling
  anchors without publishing. Use original text and an explicit UTC context.
- Accept/reject selected insertions and deletions without touching other ranges.
  An enabled tracking setting alone is not a recorded change.
- `images list` inventories an external target without networking; replacing one
  shared occurrence leaves the other unchanged unless `--shared` is explicit.
- Distinguish normal footnote/endnote bodies from separator IDs. Preserve opaque
  form-control instructions and data bindings without evaluating them.

These are original acceptance obligations, not passing tests. The existing
[test crosswalk](test-case-map.json) continues to own all 2,259 adapted source
case mappings; this acquisition task does not change their execution status.

## Shared JS and command mappings

The [SDK](../specs/office-sdk.md), [CLI](../specs/office-cli.md),
[API inventory](upstream-api-inventory.json) and [per-member map](public-api-map.json)
remain authoritative. The census does not hide inherited, helper, collection,
enum, returned or underscore-prefixed public members, including APIs with no
source tests: 920 inventoried IDs expand to 1,337 proposed rows, zero implemented.

`Document(input?: Input | null, context?: DocumentContext): Promise<DocumentModel>`
and `save(output: ByteSink | VfsPath): Promise<void>` use explicit capabilities.
Input and image admission stay async; live model access is synchronous. Preserve
neutral snake_case model members, separate from camelCase operation arguments.
Sequences use zero-based `.at`, `.length` and iteration; only documented slices
are supported. Keyed collections retain keys, and CLI ordinals are one-based.
`undefined` applies declared defaults; nullable tri-state properties distinguish
`null`, `false` and zero. Immutable units store safe integer EMUs with 914400/in,
360000/cm, 36000/mm, 12700/pt and 635/twip; rounding is halfway away from zero.
UTC dates serialize to whole seconds, bytes are owned copies, and time/identity,
font metrics and VFS authority are injected. XML/package views never grant
ambient paths, fetching, evaluation or arbitrary XPath.

Documentation drift resolves comment identity/time to `comment_id`/`timestamp`,
without invented `id`/`date` aliases. Typed enums and neutral type/value/bounds/key
errors retain their explicit per-member mappings. Public whole-text setters
remain destructive within their documented scope; `text replace` preserves
formatting. Use plural `images`, `tables`, `properties`, shared selectors and
flags, `schema` and `capabilities`. The version-1 envelope remains `version`,
`operation`, `ok`, `data`, `warnings`, `errors`, `affected`, `locations`.
Ordinary exits are 0/1/2/3/4/130; diff is 0 equal, 1 different, 2 failed, 130
cancelled. No alternate commands, source-branded identifiers or product coverage
claims follow from the acquisition results.
