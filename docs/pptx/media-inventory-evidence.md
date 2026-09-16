# Media inventory research receipt

This bounded implementation covers read-only audio/video resource associations, declared content types, SHA-256 identities, SHA-1 compatibility metadata, posters and retained playback/caption/timing XML. It does not implement the complete F42 insertion/extraction/replacement contract, live Movie model or playback. Metadata parsing does not prove playback.

## Source-case and API accounting

The pinned baseline is recorded in [the test audit](upstream-test-audit.md) and [public API audit](upstream-api-audit.md). [The media case ledger](media-case-map.json) retains 48 unit variants: 45 core movie/media cases and three related package-URI cases, plus six expanded BDD examples. Each row records an original observable obligation and its current disposition. Observational mappings explicitly keep the unimplemented constructor/property/mutation behavior pending. No pending scenario is counted as a passing adaptation.

[The API ledger](media-api-map.json) retains 48 directly media-named rows, including inherited Movie properties, returned `_MediaFormat`, constructors/equality, enums and name/value helpers. Four existing enum values have passing independent assertions: ACTION_BUTTON_MOVIE=136, MEDIA=16, WEB_VIDEO=26 and MEDIA_CLIP=10. The other 44 model/interface/enum rows remain pending. Complete transitive graph coverage remains in [the full API register](public-api-map.json); this focused ledger does not erase other obligations.

Movie insertion's source annotation incorrectly says `BaseShape`; the corrected planned return remains `Promise<Movie>`. Source positional order and neutral `add_movie`, `media_type`, `media_format` and `poster_frame` spellings remain authoritative for the future model. The source model permits a null poster default; the format command contract requires an explicit video poster. That is a retained future model-versus-operation distinction, not permission to copy a default asset or claim insertion implemented. This task's `readMedia` operation returns detached inventory records and is not a renaming or replacement of those properties.

## Exact language and security mappings

`readMedia(input, options, context)` always returns a Promise. The input is admitted through the existing byte/capability boundary. No source path string grants host filesystem authority. CLI file access uses the adapter capability. External relationship TargetMode governs embedded versus external classification: an `r:link` attribute may resolve internally. External targets have null package bytes/hashes/types and are never opened.

`MediaInventory.occurrences` and `.media` are deterministic readonly result arrays, not live collection handles. A media resource's `occurrenceIds` records every occurrence; separate relationship IDs are preserved even when their target bytes are shared. SHA-1 is metadata only; SHA-256 is the integrity identity. MIME values come from content-type declarations and do not establish codec validity. Poster absence is an empty occurrence poster array; the future live `poster_frame` property still promises `Image | null`.

Raw `playback`, `captions` and `timing` records retain qualified namespaces, XML and relationship metadata. They do not execute or evaluate time, triggers, links or codecs. The boolean `playbackVerified` is always false. There is no creation side effect in listing. CLI common selectors/envelopes and error mapping use the shared operation engine; unsupported/malformed binding failures are visible rather than silently fabricated metadata.

The broader J01–J10 model mappings remain in [language/security research](api-language-mappings.md). Public `element`, `part`, `parent`, creating line helpers, equality/ownership, inherited geometry, cropping, action and format properties remain obligations in the focused API ledger. They are not private merely because a name has an underscore.

## Caption schema reconciliation

The official caption namespace is `http://schemas.microsoft.com/office/powerpoint/2017/3/main`. Its hierarchy is `tracksInfo` / `trackLst` / `track`; `displayLoc` distinguishes media and slide placement. These are caption-track metadata, not a fabricated `captions` element in the 2010 namespace. [MS-PPTX schema 5.12](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/f696ec1a-db5c-4234-b5af-123d2c8e6a2b).

A track has required GUID `id` and string `label`, optional `lang`, and relationship references. If both `r:link` and `r:embed` occur, link takes precedence for effective selection; the inventory retains both raw bindings and makes no playback choice. [MS-PPTX CT_Track](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/d6e01ce6-91b3-4065-88d4-257fca7eb817).

Track parts use `text/vtt` and `http://schemas.microsoft.com/office/2017/04/relationships/track`; relationships may be internal or external and originate from slides/layouts/masters. This supports original schema-shaped tests without copying fixture assets. [MS-PPTX Track Part](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/dc11428a-4c7e-4e40-a94d-e78631c54bd5).

## Disposable QA and validation

[The corpus evidence](media-corpus-evidence.json) separates independently streamed ZIP/XML census from product execution. The small manifested template returns zero audio/video occurrences/resources and `playbackVerified: false`. The large media input correctly fails an explicit 32 MiB byte ceiling with `resource-limit`. Its 457,525,505-byte deck hash and 453,608,531-byte MP4 hash match the manifest; independent XML inspection finds two relationships to the same MP4 and a timing volume of 80000 targeting shape 4.

An elevated-limit full inventory of that large input was not run: only about 5.3 GB free memory was observed while the current admission/index path makes repeated full copies. No large-deck product success or playback is claimed. The meaningful duplicate-relationship and internal-link findings have tiny original regression equivalents. No cached bytes were changed, deleted, downloaded or staged.

The focused existing enum run passed four cases in `shapes-regressions.test.ts`; 269 unrelated cases were deliberately filtered, not counted as passes. The domain owner reports 24 original media cases passing in 140 ms, including Strict namespaces, MCE branch selection, present/absent posters, duplicate relationships, raw caption bindings, explicit memfs/stream admission and scope/selector rejection. Exact retained names are checked against the ledger. Maintained package and CLI checks are recorded by the coordinating owner at delivery. Research-derived descriptions retain provenance here; no source implementation or fixture bytes were copied. The existing standalone [MIT notice](upstream-license-notice.txt) remains retained.
