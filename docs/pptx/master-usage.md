# Shared master editing

The byte SDK and `pptx` command support creating masters, naming them, adding
text boxes, setting selected rectangular text-shape text/name/geometry, setting
solid RGB backgrounds, removing explicit backgrounds, and reassociating existing
layouts. Masters reuse existing themes. These operations preserve local slide
and layout XML overrides and report dependent slides separately from directly
edited objects.

```sh
pptx masters list deck.pptx --json
pptx masters add deck.pptx --scope shared --name Coastal --in-place
pptx shapes add deck.pptx --scope masters --part /ppt/slideMasters/slideMaster2.xml \
  --kind text-box --name Caption --text "Quarterly review" \
  --left 1in --top 1in --width 6in --height 1in --in-place
pptx shapes set deck.pptx --scope masters --part /ppt/slideMasters/slideMaster2.xml \
  --shape Caption --text "Updated review" --left 2in --in-place
pptx backgrounds set deck.pptx --scope masters --part /ppt/slideMasters/slideMaster2.xml \
  --kind solid --color EEF2F5 --in-place
pptx layouts set deck.pptx --scope layouts --part /ppt/slideLayouts/slideLayout1.xml \
  --master /ppt/slideMasters/slideMaster2.xml --in-place
pptx backgrounds set deck.pptx --scope masters --part /ppt/slideMasters/slideMaster2.xml \
  --kind inherit --dry-run --json
```

Read actual part URIs from inspection; the names above describe a newly created
original deck. `--theme URI` disambiguates creation when multiple existing themes
are available. `--shape` is an exact name, including numeric names. Opaque
`--select` tokens carry owner and object identity and reject stale fingerprints.
Master mutations require `--scope masters` or `--scope shared`; layout
associations require `--scope layouts` or `--scope shared`.

`--output PATH` writes a separate file; `--in-place` replaces the input through
the supplied VFS. `--dry-run` validates without publishing. `--json` returns the
versioned result, whose `data.affectedSlides` contains one-based dependent slide
positions. `affected` counts directly edited logical objects; shape locations
identify the shape, not every dependent slide. An unused master or layout has an
empty dependent-slide list. Removing an already absent background is a no-op.

The public byte functions are `readMasters`, `addMaster`, `mutateMaster`,
`mutateMasterShape` and `associateLayout`, exported by `pptx`. All take admitted
bytes/streams or explicit VFS inputs and the existing `SelectionContext` limits.
They return Promises; mutations return `{bytes, part, affectedSlides}`. Geometry
uses integer EMUs in the byte SDK and typed length flags in the CLI.
Positions may be negative; fractional CLI lengths round to the nearest EMU, with
halves away from zero. Width and height must be positive. The byte SDK uses
`shape` for exact names and `shapeId` for local identities; supplying both fails.

```typescript
const created = await addMaster(inputBytes, {
  scope: "masters",
  name: "Coastal",
  shapes: [{ name: "Caption", x: 914400, y: 914400,
    width: 5486400, height: 914400, text: "Quarterly review" }]
}, context);
const edited = await mutateMasterShape(created.bytes, {
  scope: "masters", master: created.part, shape: "Caption", text: "Updated review"
}, context);
```

`mutateMaster` accepts `background: {color: "EEF2F5"}` or `background: null`
to remove the explicit background. Text setters replace selected paragraph/run
content and preserve a required empty paragraph; they are distinct from the
future formatting-preserving `text replace` operation. Omitted edit fields retain
their values. Shared theme bytes remain unchanged.

`schema` and `capabilities --json` describe the available subset. Gradient/picture
background authoring, other shape types and the complete live object model remain
outside this increment. [Layout editing](layout-usage.md) now supports explicit
placeholder policies and the documented layout-property subset. Existing unsupported background
effects survive solid-fill edits. Unsupported selected shapes fail before
publication. There is no implicit filesystem access, network or native renderer.

The primary future live model retains neutral documented names such as
`slide_masters`, `slide_layouts`, `used_by_slides` and `text_frame`. The byte
functions above do not substitute for those live properties or collections.
