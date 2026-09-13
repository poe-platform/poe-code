# Slide merge and split usage draft

`pptx slides merge` appends an ordered selection from each source to an existing
presentation. `pptx slides split` produces one independent presentation for each
selected slide. Both copy supported relationship closures, including layouts,
masters, themes and related resources; they do not copy only slide XML.

```sh
pptx slides merge base.pptx \
  --sources '[{"vfsPath":"first.pptx"},{"vfsPath":"second.pptx"}]' \
  --source-slides '[2,1]' --theme-policy source \
  --output combined.pptx --json

pptx slides split combined.pptx --slides '[3,1]' \
  --output-dir pieces --allow-partial-output --json
```

The byte-oriented SDK exports use the same ordered selections and policies:

```ts
const combined = await mergeSlides(baseBytes, [firstBytes, secondBytes], {
  sourceSlides: [2, 1],
  themePolicy: "source",
  dimensionPolicy: "reject",
}, context);

const pieces = await splitSlides(combined, { slides: [3, 1] }, context);
// Each piece contains name, sourceSlide and independently owned package bytes.
```

Merge processes sources in listed order and applies the same `sourceSlides` list
to each source. Omitting that list selects every source slide in presentation
order. Positions are one-based, ordered and unique; every requested position must
exist in each source. An empty source selection fails. Merge requires a nonempty
source list and explicit `themePolicy`. The supported policy is `source`; `destination` fails visibly
because destination-theme conversion is not implemented. Existing `slides import`
retains its optional source default.

`dimensionPolicy` defaults to `reject`. Explicit `destination` retains the
destination page dimensions without scaling imported geometry. Import's current
supported-format restrictions also apply to merge and split. Unsupported reference
or styling conversions fail before publication.

An internal navigation link can survive merge when its target is selected from
the same source deck. A split output contains exactly one selected slide: links
to another slide cannot be satisfied by selecting that other slide for a different
output. Such cross-output navigation is rejected explicitly. Self-navigation can
remain internal to one output. Missing referenced slide parts are invalid content.
External relationships remain inert metadata; no target is fetched or executed.

Split names outputs by emitted order: the example emits `slide-000001.pptx` for
source slide 3 and `slide-000002.pptx` for source slide 1. JSON `data.outputs`
contains ordered rows with only `path`, `sha256` and `bytes`. `data.sources` reports
source positions and locations separately. Repeated identical inputs/options
produce deterministic package bytes and manifest order.

The safe-bash adapter requires explicit `--allow-partial-output` for split because
it has no multi-file transaction. The command engine can instead use an explicitly
supplied atomic directory-publication capability. All packages are constructed and
validated before any write. In partial mode, if a later write fails, the failure
result records only completed outputs. Existing directory files are not deleted
as cleanup. `--force` permits replacing explicit output files but never overwriting
an input through an alias or bypassing validation.

Merge supports `--output`, `--in-place`, `--force`, `--dry-run`, `--json` and
`--limit`; split uses `--output-dir` and rejects binary stdout. Dry-run performs
validation without publication. Inapplicable selector flags fail rather than
silently changing the requested ordered selections. JSON input paths use
`{"vfsPath":"..."}`; sources share the invocation's single stdin consumer limit.

Both operations use explicit byte, archive, XML and relationship limits across
combined work. They do not reset admission budgets for every input or emitted
package. There is no implicit host filesystem, native runtime, network, font,
identity or clock access. Public failures use the common exit profile: usage 2,
content or unsupported behavior 1, I/O 3, limits 4, cancellation 130, success 0.

The byte-oriented SDK operations and command schemas are a bounded operation
surface. They do not complete the live model, its neutral method/property
spellings, inherited members, enums, collections or typed batch obligations.
[Supplemental case accounting](slide-merge-split-case-accounting.json) retains
those individual requirements without counting package preservation as public API
parity. Corpus structural checks do not establish rendered appearance fidelity.

Split carries source slide/notes dimensions, presentation-wide text defaults,
East Asian line-break settings and supported dependencies of the chosen slide. It preserves presentation root
attributes, but does not clone package core properties, unrelated handout resources,
custom shows or section membership into every output. Each output registers its
own required notes master. Embedded fonts, unsafe identity extensions, mixed
dialects, signed/macro-enabled packages and unsupported table-style dependencies
remain explicit import limitations. Merge also rejects differing presentation-wide
text and East Asian line-break settings. Split is not a full presentation metadata
cloning operation.
