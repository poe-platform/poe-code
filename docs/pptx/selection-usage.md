# PPTX shape selection operations

These operations edit sibling shapes in an explicit coordinate space. They use
stored unrotated boxes: `slide` for top-level objects and `group` for objects
sharing one immediate group. They reject selections spanning slides, groups or
ancestors and descendants. This bounded operation API does not provide the full
live presentation model.

```sh
pptx shapes move deck.pptx --slide 1 --shape 'Summary' --order front --coordinate-system slide --output raised.pptx
pptx shapes align deck.pptx --slide 1 --all --alignment top --coordinate-system slide --output aligned.pptx
pptx shapes distribute deck.pptx --slide 1 --all --axis horizontal --coordinate-system slide --output spaced.pptx
pptx shapes duplicate deck.pptx --slide 1 --shape 'Summary' --offset-x 12pt --offset-y 0emu --coordinate-system slide --output copied.pptx
pptx schema shapes duplicate --json
```

Use `--shapes` with a JSON array of current location objects from inspection to
choose a subset, including sibling group children. Do not combine explicit
locations with simple selectors or a selection token. Locations become stale
when their input fingerprint changes. Input array order does not change sibling
order. `--all` requires the intended scope; a group and its children together
are ambiguous and fail.

Move accepts exactly one of `--order front|back|forward|backward` or a one-based
final `--position`. Front/back and position preserve selected order as a block.
Forward/backward move selected runs past one neighboring unselected object;
boundary moves do nothing. Hidden shapes participate. The `noSelect` lock on a
selected shape or ancestor rejects the whole edit.
Move/alignment/distribution also honor `noMove`; duplication honors `noCopy`.
Unrelated grouping, rotation and resize locks remain unchanged. Unselected locked
shapes are not barriers and retain their own relative order.

Alignment requires at least two shapes. Choose `left`, `center`, `right`, `top`,
`middle` or `bottom`; the anchor is the selected union box. Distribution requires
at least three shapes and accepts `horizontal` or `vertical`. It preserves both
endpoints and equalizes edge gaps, including negative gaps. Ties use existing
sibling order. Integer positions round nearest with half-EMU ties away from zero,
without accumulating rounding from preceding objects. Missing explicit geometry
fails. Rotation, flips, dimensions and group child mappings remain unchanged.

Duplicate requires both offsets, with explicit `emu`, `in`, `cm`, `mm` or `pt`
units. Copies append at the front of the sibling stack, retain source order and receive
new part-local IDs, including nested shapes. Connectors among copied objects target their copies; connector
references to unselected shapes and existing timing targets remain unchanged.
Unsupported opaque identity references fail. The result identifies the newly
serialized objects.

The byte SDK uses the same domain engine:

```ts
import { Emu, mutateShapeSelection, readShapes } from "pptx";

const records = await readShapes(inputBytes, { slide: 1 }, context);
const result = await mutateShapeSelection(inputBytes, {
  action: "duplicate",
  shapes: [records[0].location],
  coordinateSystem: "slide",
  offsetX: new Emu(500),
  offsetY: new Emu(-250)
}, context);
// result.bytes belongs to the caller; publication uses supplied capabilities.
```

The caller supplies input bytes and bounded context. The SDK performs no ambient
host I/O or network access. Operation JSON uses camelCase; existing neutral model
member spellings are unchanged. CLI slide selectors use one-based positions; `--shape` is an exact shape label,
not an ordinal or ID. Ambiguous labels fail. JS array access remains zero-based.

Package edits require `--output` or `--in-place`. `--force` authorizes replacing
an explicit output, and `--dry-run` validates without publication. `--json` emits
one structured value. `--allow-empty` permits an empty simple-selector result
as an unchanged no-op; explicit `--shapes` arrays must remain nonempty. Generated `schema` and `capabilities` expose current
availability and option constraints. Usage failures return status 2; successful
operations return 0. This page documents direct operations, not batch support.

Historical proposed command-register rows described move as position-only and
suggested direct-and-batch availability. The current format contract and
executable command schema supersede those provisional details: move now includes
order modes and all four operations require coordinate space. Neither those
historical rows nor this feature imply complete public-model API coverage.
