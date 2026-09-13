# Media editing draft usage

The SDK operations `addMedia`, `replaceMedia`, `readMedia` and `extractMedia` are async exports of the local pptx workspace. Callers provide package bytes or explicit input capabilities, admitted media/poster bytes and a bounded context. These are operation APIs; the complete live movie model remains pending.

```ts
const edited = await addMedia(input, {
  slide: 1,
  bytes: clipBytes,
  contentType: "video/mp4",
  kind: "video",
  poster: { bytes: posterBytes, contentType: "image/gif" },
  left: 914400, top: 914400, width: 1828800, height: 914400,
  trimStart: 10, trimEnd: 20, loop: true, volume: 43000
}, context);
const inventory = await readMedia(edited, {}, context);
const replacement = await replaceMedia(edited, {
  slide: 1, shape: inventory.occurrences[0]!.shapeName!,
  bytes: replacementBytes,
  poster: { bytes: replacementPosterBytes, contentType: "image/gif" }
}, context);
```

Use the actual inspected shape name or an opaque selector emitted by inspection. Do not combine opaque and simple selectors. Geometry uses integer EMU units. `trimStart` and `trimEnd` are integer milliseconds removed from the beginning and end, respectively; they are not absolute playback endpoints. Omitted trim ends serialize as zero when the other end is supplied. `volume` uses 0–100000. `loop: false` is explicit one-iteration timing, distinct from leaving imported metadata unchanged. No duration is inferred and no playback is performed.

```sh
pptx media add slides.pptx --slide 1 --file clip.mp4 --poster poster.gif --kind video --mime-type video/mp4 --left 1in --top 1in --width 2in --height 1in --trim-start 10 --trim-end 20 --loop true --volume 43000 --output edited.pptx --json
pptx media replace edited.pptx --slide 1 --shape 'Media 2' --file replacement.mp4 --poster poster.gif --output replaced.pptx --json
pptx media extract replaced.pptx --output-dir extracted --json
pptx schema media add --json
pptx capabilities --json
```

Both audio and video require explicit supplied posters in this task's implementation, following the user's explicit-bytes/poster requirement. This is narrower than the proposed format spec's optional inert audio icon; no implicit icon or frame extraction is claimed. Replacement keeps timing/trim/loop/volume and imported extensions. `shared: true` / `--shared` makes shared-resource replacement intent explicit. A selected occurrence replacement otherwise isolates its bytes from unselected users of the resource.

Extraction returns caller-owned bytes with deterministic safe filenames. Explicit deduplication groups equal bytes while retaining source-part/occurrence provenance. Output count and cumulative byte limits apply; external media stays inert and cannot be extracted by fetching its target. CLI publication uses the common destination, overwrite, dry-run and error contracts. Unsupported operations remain absent from capabilities; unknown options fail.

Supported admission checks validate bounded container signatures for the declared supported MIME profiles. They do not decode codecs, transcode, discover files or prove playback. Existing unknown imported content is opaque preservation/extraction data. This draft describes local exports and command behavior, not a published package release.
