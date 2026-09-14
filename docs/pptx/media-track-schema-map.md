# Media track schema research

Research checked 2026-09-13. This is a bounded preservation map, not a claim of a
caption authoring API, a full WebVTT parser, media-duration validation or playback.
The [MS-PPTX publication index](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/efd8bb2d-d888-4e2e-af25-cad476730c9f)
still lists revision 25.0, 2024-08-20. The base standard editions remain those in
[the format specification](../specs/pptx.md). No schema or fixture bytes were copied.

## Exact schema and preservation boundary

| Namespace / structure | Independently established fields | Boundary |
| --- | --- | --- |
| `http://schemas.microsoft.com/office/powerpoint/2017/3/main`, `tracksInfo` | required `displayLoc`: `media` or `slide`; optional single `trackLst` | Inventory and retain original XML. Do not synthesize defaults. |
| Same namespace, `trackLst/track` | zero or more ordered tracks; required `id` GUID and `label` string; optional `lang` language identifier | Keep every label, language, ID, order and unknown attribute/subtree. Never deduplicate by language or label. |
| Track relationship bindings | `r:embed` or `r:link`; at least one required; link takes precedence when both exist | Keep both bindings and their targets. External targets remain inert. |
| Track part | relationship `http://schemas.microsoft.com/office/2017/04/relationships/track`; MIME `text/vtt` | Target may be internal/external; owner must be slide/layout/master; no outgoing track relationships are defined. |

The field/cardinality rules come from [the 2017/3 schema](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/f696ec1a-db5c-4234-b5af-123d2c8e6a2b),
the precedence rule from [CT_Track](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/d6e01ce6-91b3-4065-88d4-257fca7eb817),
and relationship constraints from [Track Part](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/dc11428a-4c7e-4e40-a94d-e78631c54bd5).
Namespace-qualified identity governs recognition; a vendor element with the same
local name is opaque. A filename extension alone does not establish a caption
schema. Preserve unfamiliar extensions/MIME metadata; do not relabel bytes from
an extension guess. A `.dat` target with declared `text/vtt` remains that target.

The verified XML track schema has no cue start/end attributes. Time ranges are
inside the WebVTT payload. The [2026-05-20 WebVTT candidate recommendation draft](https://www.w3.org/TR/2026/CRD-webvtt1-20260520/)
requires cue end after start, nondecreasing cue starts, and allows overlaps.
Cue timestamps are relative to media playback. Retaining payload bytes retains
cue identifiers, timing spellings, settings, notes and unfamiliar content; this
is not validation of the complete WebVTT language or cue synchronization after
replacement with a different-duration clip.

Media playback XML is a different schema: `http://schemas.microsoft.com/office/powerpoint/2010/main`.
[CT_Media](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/f8b7e1cb-976e-4f38-8139-f9e5ffa826e8)
orders optional `trim`, `fade`, `bmkLst`, `extLst`, retaining blob bindings.
[CT_MediaTrim](https://learn.microsoft.com/he-il/openspecs/office_standards/ms-pptx/c835eea3-fd6f-4055-8a57-92b193b7b2e3)
defines `st` and `end` as durations removed from opposite ends, not cue endpoints.
Both default to zero; their sum must leave positive playable duration.
[ST_UniversalTimeOffset](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/a3ead080-d9cb-4b4a-8014-6d815248c23b)
allows nonnegative decimal values with `h`, `min`, `s`, `ms`, `µs`, `ns`, or no
unit (milliseconds). Preserve imported lexical forms without normalization.
The existing integer-millisecond insertion options are a narrower admission
surface; a recognized container header does not prove duration constraints.

The exact extension placement is `m:media/m:extLst/p:ext/c:tracksInfo`, then
`c:trackLst/c:track`, where `m` is the 2010 media namespace, `p` the base
PresentationML namespace and `c` the 2017/3 track namespace. The media-local
`extLst` element has imported type `p:CT_ExtensionList`; its `ext` children are
therefore `p:ext`, not `m:ext`. MS-PPTX revision 25.0 section 2.2.4.1 assigns
track extension URI `{3AFAAA56-56D3-431D-BCD4-E75A35582382}` beneath media.
Section 2.2.4 assigns media extension URI
`{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}` beneath `p:nvPr/p:extLst/p:ext`.
These placements and URIs were checked in the [official 2024-08-20 PDF, pages
21–22](https://officeprotocoldoc.z19.web.core.windows.net/files/MS-PPTX/%5BMS-PPTX%5D.pdf)
and [the 2010 schema](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/cc915728-85a4-46a0-a07c-eb5416a5762e).
The known-track SDK fixture uses `m:extLst/p:ext`; intentionally unfamiliar
`m:ext` wrappers in opaque regression cases establish preservation only.
Neither a shape-binding guard nor byte preservation validates an extension URI
or the complete track schema. The insertion URI discrepancy was independently
reported to the coordinator; correcting it requires its own original assertion.

## Replacement and compatibility decisions

A safe media replacement changes only independently recognized clip/poster
bindings or their uniquely owned relationship targets. The bounded guard rejects
unknown selected-shape metadata that aliases a clip/poster relationship ID:
its meaning cannot establish that cloning or retargeting would preserve its
association. Track relationships and payload parts must survive. Reject a
binding whose requested mutation cannot preserve a track, including a
caption/clip role collision or an unresolved required binding. Unknown metadata
is preservation content, never permission to rewrite it.

MCE branch selection and preservation are separate obligations. This change
retains opaque extension branches and their relationship closure; extension
metadata inventory is raw preservation evidence, not active MCE semantic track
selection. The eventual semantic reader must select an understood Choice
(otherwise Fallback) while retaining inactive serialized branches. The
[format specification](../specs/pptx.md) pins ECMA-376 Part 3 and requires that
behavior. This receipt does not claim that the existing raw extension walk
implements it, or that recognition validates all track fields. No caption/cue
editing API is introduced. Imported trim units are preserved, not semantically
edited or verified against media duration.

## API/test accounting and documentation drift

[The track case ledger](media-track-case-map.json) retains all 48 matching unit
variants and six expanded BDD identities from [the full test inventory](upstream-test-inventory.json).
There are zero caption/track-specific identities in that baseline, so new track
regressions supplement it; they cannot be claimed as previously missing source
cases. Prior exact original test references remain in [the editing ledger](media-editing-case-map.json).
All 48 direct media public API identities are retained with their exact target
signatures and mapping IDs; four enum-value receipts and 44 model gaps remain
unchanged. Inherited members, `_MediaFormat`, equality, owner views, collections,
helpers and untested public APIs remain obligations in [the complete register](public-api-map.json).

J01/J02 retain neutral model spellings, positional order and live owner identity;
`undefined` defaults and permitted `null` absence stay distinct. J03 maps sequence
access to zero-based JS collections and retains keyed lookup distinctions. J04
retains typed enum symbols and values. J05 preserves safe exact numeric values;
SHA-1 is compatibility metadata, SHA-256 integrity identity. J06 always makes
admission/save asynchronous and maps bytes to owned `Uint8Array` and paths to
explicit VFS capabilities. J07 supplies original defaults and explicit time;
no ambient host/native/network access. J08 retains stable typed failures and
shared exit categories. J09 exposes only bounded owner-aware XML/package views.
J10 routes behavior through the shared command engine with selectors, camelCase
operation options, dotted IDs, version-1 envelopes and schema/capabilities.
These mappings do not implement pending live APIs.

The corrected `add_movie` signature returns `Promise<Movie>`, not the erroneous
source GraphicFrame annotation (D03); `PP_MEDIA_TYPE.SOUND` retains D09's reconciled
disposition. Explicit posters at today's operation boundary do not satisfy the
future model's optional original default-poster behavior. Published version 1.0.0
versus pinned source 1.0.2 remains recorded drift, not a new parity claim.
The [API audit](upstream-api-audit.md) and [test audit](upstream-test-audit.md) are
historical checkpoints; this receipt supplements rather than rewrites their
past execution claims. MIT provenance remains in [the standalone notice](upstream-license-notice.txt).

## Corpus evidence boundary

The manifest contains 14 disposable documents; none lists the 2017/3 caption
namespace in its recorded namespace census. This absence is a census observation,
not evidence that every extension payload was semantically characterized.
No corpus downloads or new corpus edits ran in this research task. Small original
fixtures are required to establish captions, multiple tracks and MCE behavior;
unit tests must not rely on corpus cache availability. The existing large-media
fixture exceeds default limits and is not evidence of successful playback/editing.
All execution procedures and pending checks belong in [the plan](../plans/pptx-media-tracks.md).
