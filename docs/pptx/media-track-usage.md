# Media replacement with captions

`replaceMedia(input, options, context)` and `pptx media replace` preserve caption
track XML, labels, languages, ordering, relationships and original payload bytes.
Unknown extension attributes and Choice/Fallback content are retained. Internal
track types come from package content types, including targets without a `.vtt`
extension. External caption links remain inert.

Supply replacement media and an explicit poster through the existing media
replacement options. Select one shape, or explicitly request all/shared owners.
Replacement does not retime caption cues, validate playback duration, translate
captions or expose a caption setter.

A shape whose unsupported metadata shares a clip or poster relationship binding
fails with `unsupported-edit` before publication. The CLI reports exit status 1;
SDK callers receive the corresponding `OfficeError`. Neither `--force` nor
`--shared` bypasses this validation. Existing input and destination bytes remain
unchanged on rejection.

The inventory's `captions` field contains raw namespace-qualified metadata and
relationships. It is preservation evidence, not a normalized cue model or a
claim that inactive extension branches were selected for playback.

Track schema details and the current preservation boundary are recorded in
[the schema map](media-track-schema-map.md).
