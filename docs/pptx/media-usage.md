# Media inventory draft usage

`pptx media list slides.pptx --json` inventories audio/video metadata. It distinguishes embedded package parts from inert external targets, preserves multiple relationships to the same media and reports poster, playback, caption and timing associations.

```sh
pptx media list slides.pptx --slide 1 --json
pptx media list slides.pptx --slide 1 --shape 'Overview clip' --json
pptx schema media list --json
pptx capabilities --json
```

The SDK operation is `await readMedia(input, options, context)`. `input` is supplied bytes or an explicitly scoped byte/VFS capability, and `context` provides byte, archive, XML and relationship limits. Options use `scope`, one-based `slide`, `shape` name and the opaque `select` token emitted by inspection. Do not combine an opaque token with simple selectors.

Results contain `occurrences`, unique package `media` resources and `playbackVerified: false`. Each occurrence includes its location, source part, shape identity, kind, relationships, posters and raw playback/caption/timing metadata. Embedded resources include declared content type, byte length, SHA-256 and SHA-1 metadata. Linked resources remain inert and have no fabricated byte length or hash.

The CLI wraps data in the shared version-1 result envelope with operation `media.list`, zero affected objects and diagnostic arrays. Listing is read-only. Unknown or inapplicable options fail rather than being silently ignored; common error categories and exit statuses apply.

Metadata parsing does not prove playback, codec support, caption display or timing execution. Media insertion, extraction, replacement and the live movie object model remain outside this bounded inventory implementation.
