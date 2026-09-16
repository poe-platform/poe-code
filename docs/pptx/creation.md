# Presentation creation draft

The creation operation authors an original macro-free package. An omitted slide
list produces zero slides, with one blank layout, one master, a theme and an
explicit 12192000 by 6858000 EMU canvas. Supplying only one dimension retains the
default for the other. Output kind is explicit: `pptx`, `potx` or `ppsx`; it is
not guessed from the output filename.

```sh
pptx create -o survey.pptx
pptx create --kind potx --width 10in --height 7.5in -o survey.potx
pptx create --kind ppsx --author 'River team' --timestamp 2024-02-29T12:34:56Z -o survey.ppsx
pptx create --dry-run --json
```

Creation never discovers an author or reads the clock. Omitted metadata remains
absent. Explicit timestamps are UTC and serialize to whole seconds. Generated
ZIP timestamps are fixed, so identical inputs and limits produce identical bytes.
The theme, master and layout are authored defaults; no external template is
copied into the product.

`--slides-json` takes an array of slides with optional `name` and `shapes`.
Each shape is a text box with required integer-EMU `x`, `y`, `width`, `height`
and `text`, plus optional `name`. Newline separates paragraphs; vertical tab
separates soft line breaks. Empty strings and empty paragraphs are retained.

```sh
pptx create --slides-json '[{"name":"Survey","shapes":[{"name":"Heading","x":914400,"y":914400,"width":8000000,"height":914400,"text":"Cedar & sky"}]}]' -o survey.pptx
pptx create --properties-json '{"title":"Survey","revision":0,"lastModifiedBy":"River team"}' -o survey.pptx
```

`--properties-json` accepts `title`, `subject`, `author`, `keywords`, `comments`,
`lastModifiedBy`, `revision`, `created`, `modified` and `lastPrinted`. Core text
allows 255 Unicode code points. Revision is a nonnegative safe integer. Date
values are explicit UTC strings. Supplying an author or timestamp twice through
overlapping options is an error. Unknown fields and duplicate JSON keys fail.

The typed byte SDK is `createPresentation(options, context): Promise<Uint8Array>`.
Import it from `poe-code/pptx` or the workspace `pptx` package. It returns owned
package bytes without publishing them. `width` and `height` are integer EMUs;
the CLI converts suffixed lengths to EMUs, rounding once. Slide dimensions are
914400 through 51206400 EMUs. The context explicitly supplies byte, archive,
XML and relationship limits plus optional cancellation, as declared by
`SelectionContext`. Typed metadata dates are `Date` values; its neutral metadata
spellings retain `last_modified_by` and `last_printed`. The command JSON uses
`lastModifiedBy` and `lastPrinted` and maps to those fields explicitly.

SDK creation options are `kind`, `dialect`, `width`, `height`, `slides`,
`properties`, `author` and `timestamp`. `timestamp` supplies both created and
modified metadata. The same creation implementation backs the command engine.
This byte operation does not implement the proposed `Presentation` live-model
factory, inherited members or subsequent slide editing.

Creation requires `--output` except in dry-run. Existing destinations require
`--force`, which does not bypass admission or validation. Binary `--output -`
conflicts with `--json` unless dry-run; dry-run publishes nothing. The explicit
safe-bash plugin uses only its supplied VFS and publication capabilities.

Use `pptx schema create --json`, `pptx help create` and
`pptx capabilities --json` for the executable subset and closed option schemas.
Structured creation is separate from template binding and subsequent editing.
The complete proposed live model, template population, custom layouts/themes,
Strict creation and typed batch routes are not established by this operation.

See [creation accounting](creation-case-map.json) and the
[verification plan](../plans/pptx-creation.md) for the exact evidence and limits.
