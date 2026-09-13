# Presentation corpus verification evidence

Status: Preparation only. No product, visual, playback or release result.

[The receipt](corpus-reverification.json) verifies all 12 manifest-listed cached
downloads, totaling 585,043,691 bytes, against their recorded SHA-256 hashes before
and after inspection. All 337 media hashes match. All 1,337 ZIP entries passed
streaming CRC verification; the receipt adds actual byte counts and SHA-256 for
every part. Selected census counters match the existing manifest. Source bytes
were not modified, copied or deleted. This verifies existing downloads, not a
fresh HTTP transfer or the current bytes served by each publisher.

The single inspection sample totals 1.167402 seconds, including both source hash
passes, member hashing and XML parsing. Per-file measurements and environment are
recorded. Cache state was uncontrolled; these are host research timings, not
`pptx` load/save timings. Animation timing-tree/node counts describe stored XML
and do not measure playback duration or correct animation targeting.

The [agent procedure](../plans/pptx-corpus-reverification.md) governs this audit.
The manifest remains the acquisition authority. The receipt is research evidence,
not a product detector implementation or an OOXML validation certificate.

## Observed gaps

| Family     | Observed evidence                                                                                                                         | Remaining coverage                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Charts     | Zero chart/diagram namespace elements under the documented scan                                                                           | Category/date/hierarchical data, XY/bubble, chart caches/workbooks, combination/extended charts                              |
| SmartArt   | Zero diagram namespace elements                                                                                                           | Complete data/layout/style/color/fallback relationship graph and opaque retention                                            |
| Comments   | One legacy author in `ppt/commentAuthors.xml`; no comment body found                                                                      | Legacy author-to-comment links, modern threads/replies, resolved state and timestamps                                        |
| RTL/CJK    | No RTL characters or enabled RTL attributes; four CJK-range characters occur only in the application font-list metadata of the Suomi deck | Actual RTL/CJK slide/notes runs, mixed direction, combining marks, vertical content, supplied font metrics                   |
| Strict     | Zero Strict namespace elements                                                                                                            | Strict package relationships and editing without dialect conversion; mixed-dialect rejection                                 |
| Signatures | Zero XMLDSig elements                                                                                                                     | Signed package graph, signature origin/relationships, explicit mutation policy and refusal                                   |
| Media      | One video reference and one 453,608,531-byte MP4; no audioFile references                                                                 | Tiny default-profile audio/video, posters, external targets without fetching, trim/loop/captions, shared media and playback  |
| Layout     | Nested groups, rotations, negative offsets; 4:3, 16:9, 16:10 and a nonstandard EMU size                                                   | Portrait/extreme aspect ratios, missing/ambiguous placeholders, master reassignment, inheritance overrides, many-slide decks |

These are qualified observations, not exhaustive feature-detection guarantees.
Counts include notes, layouts, masters and unselected MCE branches. Vertical
attributes alone do not prove visible vertical text. Comment author metadata
alone does not prove a comment exists. Font-list metadata is not CJK text-layout
evidence. Media filenames and relationships do not prove a valid playable codec.

## Profile separation

Eleven inputs are candidates for the proposed default compressed-input/media
limits; that does not mean they pass all product limits or validation. The large
deck has 457,525,505 compressed bytes and a 453,608,531-byte media part, each above
268,435,456 bytes. Default product admission is therefore predicted to reject
with the resource-limit category (ordinary CLI exit 4), without publication.
No such command has run.

The existing 512 MiB individual-member census ceiling admitted the large deck;
expanded bytes remained below 1 GiB. This is a census outcome only. A trusted
raised product profile still needs independent admission, edit, save, reopen,
preservation and cancellation evidence. One large video is not a many-slide test.

## Publisher and rights evidence

The web-reader review confirmed the official [large-deck listing](https://svs.gsfc.nasa.gov/31139/)
and its PPTX link, the [interactive-deck listing and credit](https://science.nasa.gov/resource/collection-of-interactive-powerpoint-slides-to-be-used-in-public-engagement/),
the [IXPE template listing](https://ixpe.msfc.nasa.gov/for_scientists/templates/)
and the [ISOLDE template/drawing listing](https://isolde.web.cern.ch/isolde-logos-layouts-and-templates).
The Indico landing-page review returned an internal retrieval error; the cached
bytes still match their recorded acquisition hash. The other landing pages were
not freshly reviewed. No listing proves asset-specific redistribution permission.

[NASA's media guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/)
describes educational/informational use and acknowledgement, while separating
third-party copyright, logos, identifiable people and endorsement restrictions.
[CERN's audiovisual terms](https://copyright.web.cern.ch/) retain copyright,
require credit, restrict redistribution and reserve logo use for prior approval.
Their applicability to every embedded asset is not established by a host name.
The generic publisher fields in the manifest are provenance leads, not verified
authorship or clearance for each part. Document-specific credits remain unreviewed
as a complete set; no outputs or source assets are approved for distribution.

## Original regression designs

These are small original TypeScript acceptance designs, not implemented tests or
reproduced product failures. They derive structural risks from the observations;
no downloaded wording, image, font, media or XML is reused.

| Neutral case ID                          | Original arrangement and action                                                                                                                                  | Independent expected result                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `author-list-without-comments`           | Build an in-memory deck with one original author record and no comment body; call noncreating inspection                                                         | Zero comments, one retained author record; inspection does not create a comment or alter bytes                                                                              |
| `font-metadata-without-cjk-runs`         | Build Latin slide text with an independently chosen Japanese font-list label; inspect text and replace a Latin word                                              | Text inventory contains only slide text, font metadata remains separate, and the untouched metadata part hash survives                                                      |
| `media-limit-independent-of-slide-count` | Supply one-slide original bytes with a tiny valid authored media payload of N bytes and a trusted N−1 byte media ceiling; repeat with an explicit N-byte ceiling | First attempt raises the limit category before publication with unchanged destinations; raised-profile evidence is separate and cannot relabel the rejection a default pass |
| `nested-negative-offset-retention`       | Build two nested original groups with negative offsets and one rotated child; edit an unrelated notes paragraph                                                  | Unaffected slide part bytes and integer transforms remain identical; notes-only scope does not clamp or flatten geometry                                                    |

The actual implementation must establish red/green behavior and round-trip
assertions with original in-memory fixtures. Until then these findings remain
open regression obligations. The existing source corpus stays disposable and
outside unit-test dependencies.
