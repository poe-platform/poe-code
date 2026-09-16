# Slide import usage draft

`pptx slides import` copies an ordered selection from one presentation into another.
It preserves the source layout, master, theme and related resources by default.
The SDK operation is `importSlides(destination, source, options, context)`;
operation options use camelCase. This byte-oriented operation is separate from
live model properties and their documented neutral spellings.

```sh
pptx slides import destination.pptx --source source.pptx \
  --source-slides '[3,1]' --output combined.pptx --json
```

`sourceSlides` / `--source-slides` is a required nonempty JSON array of unique,
one-based source slide positions. Requested order is retained. `position` /
`--position` inserts before that one-based destination position; omission appends.
The allowed insertion range is `1` through destination slide count plus one.

```ts
const result = await importSlides(destinationBytes, sourceBytes, {
  sourceSlides: [3, 1],
  position: 1,
  themePolicy: "source",
  dimensionPolicy: "reject",
}, context);
```

Both inputs require admitted bytes or explicitly authorized input capabilities.
The caller supplies byte, archive, XML and relationship limits through `context`.
The operation does not discover host files, contact external links, activate
embedded objects, run native software or download templates. Publication uses
explicit output authority. No author or clock time is synthesized.

The default `themePolicy` / `--theme-policy` is `source`. This follows the current
source-appearance requirement and resolves the older format table's requirement
to supply the policy explicitly. `destination` is a visible unsupported request;
matching placeholders and translating their inherited styling is not implemented
by this operation.

The default `dimensionPolicy` / `--dimension-policy` is `reject`: different slide
or notes page dimensions fail before publication. Explicit `destination` keeps
the destination page dimensions and leaves imported coordinates and sizes intact.
It does not scale shapes or promise identical framing on a different canvas.

```sh
pptx slides import destination.pptx --source source.pptx \
  --source-slides '[1]' --dimension-policy destination \
  --output combined.pptx --json
```

Supported copied dependencies include layouts, slide masters, notes, their master/theme
resources, charts with embedded workbooks, and inert image/audio/video parts. Names alone never justify merging
resources. Part names, relationship targets and supported IDs are remapped without
rewriting unrelated destination payloads. Internal cycles and shared resources
remain relationships, while external relationships remain inert metadata. An
unsupported reference that cannot be safely remapped fails explicitly.

A presentation can register only one notes master. An imported notes master can
be registered when the destination lacks one. If the destination already has a notes master and the copied closure also needs
one, the import fails; it cannot add a second registered master or silently replace
the destination's notes styling. Equivalent notes-master reuse is not implemented.
Imported resources receive separate deterministic names; no resource deduplication
is claimed.

`--dry-run` validates the requested import without publishing output. `--output -`
without `--json` writes only presentation bytes to stdout. Structured results use
the common JSON envelope and operation name `slides.import`. Schema and capability
responses expose the operation's actual supported options. Invalid argument shape
uses exit status 2; document validation or unsupported behavior uses 1; input or
publication failure uses 3; limits use 4; cancellation uses 130; success uses 0.

Dependency preservation does not implement the complete live presentation model,
its inherited members, enums, resource characterization or drawing/chart/text
editing APIs. [Supplemental case accounting](slide-import-case-accounting.json)
retains the individual relevant case/API obligations without treating generic
byte preservation as completed behavioral parity.

The current import boundary rejects tables, unsupported dependency relationships,
opaque identity extensions, signed or macro-enabled packages, and mixed XML
dialects. Internally linked slides must all be selected. Preservation is structural
within this boundary; successful real-world corpus import and rendered source
appearance have not been established. Corpus runs rejected unsupported opaque
identity extensions. Readable command screenshots establish command presentation
only, not slide rendering fidelity.

Presentation-wide text defaults must be structurally equivalent between source and
destination; differing namespace prefixes alone do not make them unequal. An
embedded-font list in either presentation is unsupported, including an empty list.
The importer does not rewrite global text defaults or transfer embedded fonts.
