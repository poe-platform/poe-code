# Presentation settings usage draft

The workspace `pptx` command exposes `settings list`, `settings get` and
`settings set`. These operations share the byte SDK domain behavior. This draft
covers workspace support; it does not announce a published package or complete
live object model.

```bash
pptx settings get deck.pptx --json
pptx settings list deck.pptx --json
pptx settings set deck.pptx --width 12in --height 6.75in --output wide.pptx
pptx settings set wide.pptx --orientation portrait --in-place
pptx settings set wide.pptx --notes-width 7.5in --notes-height 10in --in-place
pptx settings set wide.pptx --notes-orientation landscape --in-place
pptx settings set deck.pptx --slide-number-start 3 --loop true --show-type kiosk --output show.pptx
pptx settings set deck.pptx --width 10in --dry-run --json
pptx schema settings set --json
pptx capabilities --json
```

Settings address the whole presentation; slide, shape and opaque location selectors
are inapplicable. `get` returns `data.settings`; `list` returns a singleton
`data.records` array. Both include the admitted input fingerprint. Dimensions are
integer EMUs, and absent dimensions are null. Absent numbering defaults to 1;
absent slideshow settings read as loop false and show type speaker. Reading
settings does not create missing notes, settings or other parts.

CLI dimensions accept `emu`, `in`, `cm`, `mm` or `pt`. Conversion rounds once to
integer EMUs, with halfway values away from zero. Byte SDK dimension arguments
are already integer EMUs. Orientation swaps an existing width/height pair as
needed; contradictory explicit dimensions fail. Square canvases read as landscape
and reject portrait requests. Notes dimensions may be zero and their orientation
is independent of the slide canvas. Slide number start is a signed 32-bit
integer. Slideshow type is `speaker`, `window` or `kiosk`, and loop is an explicit
Boolean (`--loop true` or `--loop false`).

Size changes affect the canvas by default. They preserve shape coordinates,
text sizing and slide/notes/master content. `--scale-content true` is explicit;
it scales explicit unrotated shape geometry and group outer geometry in slides,
layouts and masters. Group child coordinates remain unchanged because the group's
outer transform scales them together. This geometry operation does not resize
font values. Missing/inherited geometry, unsupported transforms, conditional
content and animation fail before publication. The supported subset and rejection
reasons are exposed by schema/capabilities. Changing a slideshow option
preserves unrelated show properties. Grid, view, print, custom-show references
and vendor settings outside the requested edits are retained; this does not
promise semantic editing of every setting.

The byte SDK exports the following operations from the workspace package:

```typescript
const before = await readPresentationSettings(inputBytes, context);
const outputBytes = await mutatePresentationSettings(
  inputBytes,
  {
    width: 10972800,
    height: 6172200,
    notesOrientation: "portrait",
    slideNumberStart: 3,
    loop: true,
    showType: "kiosk"
  },
  context
);
```

The caller supplies admitted bytes or an explicit capability-scoped VFS input and
context limits. Both operations are asynchronous. They do not discover host
files, identity, time, fonts or network authority. The mutator returns package
bytes; publication remains explicit through the caller or configured CLI adapter.

CLI mutations require `--output PATH` or `--in-place`, except dry-run. Existing
output needs `--force`; an input alias still requires `--in-place`. Read and
dry-run JSON use the common version-1 result envelope. Inapplicable/unknown flags,
invalid values and conflicting output options fail before publication.

This operation API does not implement live `Presentation.slide_width` or
`slide_height` assignment, `Length` value helpers, inherited public XML/package
views or the complete documented model. Those remain recorded API obligations.
