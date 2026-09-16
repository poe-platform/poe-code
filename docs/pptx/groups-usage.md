# Group geometry

Draft usage for the bounded `pptx` group/ungroup operations. The caller supplies a
nonnegative EMU tolerance; there is no default. Zero requests exact geometry.
Grouping requires at least two distinct sibling shapes. Ungrouping selects one
group. The implementation must preserve each child's identity and relative paint
order, and reject operations whose geometry or affected references cannot be
preserved safely.

Stored shape positions remain coordinates in their immediate parent. Inspected
`geometry.corners` are projected into slide space, and `geometry.groupPath`
identifies the ancestor groups. The group child offset and child extent define
how child coordinates map into the group's box; rotation and flips apply about
the box center. A zero child extent is singular and cannot be projected.

The API operation is separate from the proposed live `GroupShape.shapes` model
collection. Empty/single-child model creation and automatic collection extent
recalculation remain public API obligations; the two-shape minimum of the safe
operation does not redefine those model behaviors.

[Case accounting](groups-case-map.json) retains every group-related parametrized
unit case and expanded scenario, including remaining neighboring model gaps.
[API accounting](groups-api-map.json) retains inherited members and exact proposed
JavaScript signatures. Existing [transform behavior](transform-case-map.json)
and [transform APIs](transform-api-map.json) cover unchanged geometry members.

Discover exact operation schemas with `pptx schema shapes group --json` and
`pptx schema shapes ungroup --json`. Grouping supplies `--shapes` as a JSON array
of inspected location records, avoiding ambiguous shape names. For example:

```sh
pptx shapes group deck.pptx --shapes "$LOCATIONS_JSON" --tolerance 0emu --output grouped.pptx
pptx shapes ungroup grouped.pptx --slide 1 --shape "Group" --tolerance 0emu --output restored.pptx
```

Use the actual group name from inspection for the second command, or its current
`--select` token. Tokens from a previous package fingerprint do not authorize
selection in the changed package. `--dry-run` validates without publication;
`--in-place` is an explicit alternative to `--output`. JSON output and errors use
the common command envelopes and exit statuses.

Grouping introduces an identity child mapping and retains original child XML.
Ungrouping an identity-mapped wrapper can likewise retain child transforms.
For a nonidentity transform, supported editable geometry is deliberately bounded
to plain rectangles with an explicit absent stroke and nested groups without
inherited formatting/effects. Text, pictures, arbitrary preset/custom geometry,
effects and transforms requiring shear are rejected when safe visual bounds
cannot be established. This is a visible capability limit, not silent geometry
approximation. Connector/timing references to a removed group reject; retained
child identities continue to identify the same shapes, with affected unsupported
timing transforms rejected.

Ungroup also rejects populated timing or extension trees in the owning drawing:
opaque references cannot safely be retargeted. This applies even to identity
wrappers. No timing or extension retargeting support is implied.

The built workspace SDK exposes the same engine (this is not a claim of a
separately published package):

```ts
import { Emu, groupShapes, readShapes, ungroupShape } from "pptx";

const shapes = await readShapes(bytes, { slide: 1 }, context);
const grouped = await groupShapes(
  bytes,
  {
    shapes: shapes.slice(0, 2).map((shape) => shape.location),
    tolerance: new Emu(0)
  },
  context
);
const records = await readShapes(grouped.bytes, { slide: 1 }, context);
const group = records.find((record) => !shapes.some((shape) => shape.shapeId === record.shapeId))!;
const restored = await ungroupShape(
  grouped.bytes,
  {
    select: group.token,
    tolerance: new Emu(0)
  },
  context
);
```

`bytes` and the capability/limit `context` are caller-supplied. The example assumes
the first two shapes are contiguous siblings. It selects the newly allocated group
ID from refreshed inspection; original tokens become stale when the package changes.

Nonidentity ungroup currently requires quarter-turn rotations throughout the
transform chain. Its tolerance proof uses exact rational arithmetic, so even a
fractional EMU hidden by a large world offset cannot pass zero tolerance.
General-angle nonidentity transforms reject; identity wrapping/unwrapping can
preserve general angles by retaining the original child XML unchanged.

These operations have fixed selection cardinality, so `--all` and `--allow-empty`
are rejected. The generic format operation table lists broader shared flags;
the executable group schemas intentionally expose the narrower valid set.
