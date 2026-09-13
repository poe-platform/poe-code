# Layouts and placeholders

The workspace `pptx` byte SDK and explicit safe-bash command can inspect, create,
edit, remove and apply layouts. Read results include registered layout IDs,
master parts, names, properties, placeholders and dependent slide positions.
Shared mutations require `--scope layouts` or `--scope shared`.

```sh
pptx layouts list deck.pptx --json
pptx layouts add deck.pptx --scope layouts --master "Original master" \
  --name Article --type obj --preserve true \
  --placeholders-json '[{"name":"Content","type":"body","index":1}]' --in-place
pptx layouts set deck.pptx --scope layouts --part /ppt/slideLayouts/slideLayout2.xml \
  --matching-name article --show-master-shapes false --in-place
pptx layouts apply deck.pptx --slide 1 --layout Article \
  --placeholder-policy type-index --in-place
pptx layouts apply deck.pptx --all --layout Article \
  --placeholder-policy reject-unmatched --dry-run --json
```

Names and part URIs in these examples describe an original newly created deck.
Use actual names/parts from inspection for an existing document. `--master` and
`--layout` resolve an exact name or canonical part URI; ambiguity fails. Opaque
`--select` tokens reject stale fingerprints. `--slide` is one-based and can select
the layout used by that slide for layout inspection or shared editing.

Applying a layout requires an explicit policy. `type-index` matches normalized
placeholder type/index and retains unmatched local content. `reject-unmatched`
fails if any local placeholder has no match. Both retain ordinary local objects,
reject duplicate placeholder indexes and preserve local XML, text and formatting.
The layout relationship changes; inherited appearance can consequently change.
The operation does not copy prompts, create missing local placeholders or flatten
inherited formatting into the slide. Omitted placeholder type is `obj`; omitted
index is zero. Shape IDs are separate from placeholder indexes.

Supported layout properties are name, type, preserve, showMasterShapes and
matchingName. Boolean flags take `true` or `false`; omission preserves existing
values. `--matching-name ''` clears that value. `layouts set --master` moves the
layout to another existing master while preserving its ID and local content.
`layouts set --text` needs a selected `--shape` name or opaque shape token and
replaces that shape's paragraph/run content. Creation `--text` adds a local text
box. A referenced layout cannot be removed.

Creation placeholders accept optional name/type/index/text and integer EMU
x/y/width/height. If one member of a coordinate pair is supplied, its companion
is zero; omitted pairs remain inherited. Negative positions and zero dimensions
are supported within bounded integer ranges. Rich-content placeholder types
reject text coercion. Inspection reports effective x/y/width/height and individual
`layout`, `master` or null provenance. Zero-valued local geometry overrides a
master value. Content/table/subtitle placeholders inherit master body geometry, and
centered titles inherit master title geometry. These inheritance categories are
separate from application's exact type/index policy.

The byte SDK exports `readLayouts`, `addLayout`, `mutateLayout`, `removeLayout`
and `applyLayout` from the local workspace package `pptx`.

```typescript
import { addLayout, applyLayout, readLayouts } from "pptx";

const created = await addLayout(inputBytes, {
  scope: "layouts", master: "Original master", name: "Article",
  placeholders: [{ name: "Content", type: "body", index: 1 }]
}, context);
const applied = await applyLayout(created.bytes, {
  selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
  layout: created.part, placeholderPolicy: "type-index"
}, context);
const layouts = await readLayouts(applied.bytes, context);
```

All byte functions are async and use the existing explicit `SelectionContext`
limits and cancellation. Mutation results contain bytes, part and affectedSlides;
the caller decides publication. CLI output uses the common version-1 envelope.
`affectedSlides` is ordered one-based dependent-slide data, separate from the
count of directly edited objects. `--output`, `--in-place` and `--dry-run` retain
the shared publication contract. Read-only inspection creates no definitions.

These snapshot operations do not implement the complete live object model.
Neutral model names such as `slide_layouts`, `get_by_name`, `used_by_slides` and
`placeholder_format`, their collection/error behavior, and rich placeholder
replacement handles remain separate public API obligations. There is no implicit
host I/O, network, native renderer or rendering-fidelity claim.
