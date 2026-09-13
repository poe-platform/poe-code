# Custom paths

Draft usage for the bounded `pptx` path operations. This is separate from the
broader freeform builder model, which remains incomplete.

Use `shapes paths add` to create a custom shape and `shapes paths set` to replace
a supported existing path. Shape placement accepts explicit length units. The
path has its own positive viewport dimensions and integer local EMU coordinates;
the viewport maps onto the shape's placement width and height.

```sh
pptx shapes paths add deck.pptx --slide 1 --name Ribbon \
  --left 1in --top 1in --width 3in --height 2in \
  --path '{"unit":"emu","width":300,"height":200,"commands":[{"type":"move","x":0,"y":100},{"type":"quadratic","cx":150,"cy":0,"x":300,"y":100},{"type":"cubic","cx1":240,"cy1":200,"cx2":60,"cy2":200,"x":0,"y":100},{"type":"close"}]}' \
  --output ribbon.pptx --json
```

For straight segments, use `--vertices '[{"x":0,"y":0},{"x":300,"y":0},{"x":0,"y":200}]'`
and explicit `--close true` or `--close false` instead of `--path`. A closed
vertex polygon requires three distinct vertices. Its viewport is at least one
on each axis and otherwise uses the largest positive coordinate. Coordinates
are not shifted, including negative values.

Commands are `move`/`line` with `x,y`, `quadratic` with `cx,cy,x,y`, `cubic` with
`cx1,cy1,cx2,cy2,x,y`, and `close` without additional fields. Each subpath starts
with a move and draws at least one segment. After close, start another subpath
with move. Open paths stay open. Command order and contour winding are retained.

Coordinates must be integers between -2,147,483,647 and 2,147,483,647. Viewport
dimensions range from 1 to 2,147,483,647. A path accepts at most 4,096 commands.
No formulas, arcs, automatic closure, geometry simplification, intersections or
boolean operations are provided. Existing unsupported geometry can be inspected
and preserved but cannot be replaced through the bounded path operation.

SDK operations are `addShapePath(input, options, context)` and
`setShapePath(input, options, context)`. Both are always asynchronous, accept
explicit admitted bytes/byte sources/VFS capabilities, and return bytes plus
affected-object information. Add uses `{ slide: 1, path, update: { left, top,
width, height, name } }`; placement values are explicit `{ value, unit }` lengths.
Set uses `{ slide: 1, shape: "Ribbon", path }` and retains placement and styling.
Omitted selection scope means slides; layouts/masters require explicit scope.
For set, multiple matches require `all: true`; empty matches require
`allowEmpty: true`. Add selects exactly one owning part.

`readShapePaths(input, selection, context)` and CLI `shapes paths list|get`
inspect geometry without changing it. Records include the original `xml`, a
supported `path` or null, and an `unsupported` boolean. Picture and connector
custom geometry is returned as preserve-only; shape-path set cannot replace it.
Ordinary shapes without custom geometry have null XML/path and `unsupported:
false`. List may return several records; get requires exactly one.

The synchronous helpers are also exported:

- `validateShapePath(path)` validates without changing input.
- `pathFromVertices(vertices, close)` creates the bounded line-path value from
  exact `{x,y}` objects or two-element `[x,y]` tuples. CLI vertices use objects.
  This helper accepts 2–4,095 vertices, leaving room for explicit close.
- `shapePathXml(path, namespace)` serializes in the explicitly supplied Strict
  or Transitional DrawingML namespace.
- `readShapePath(document, node)` inspects one parsed shape, picture or connector
  node; `applyShapePath(document, node, path)` returns an edited XML part only for
  a supported existing shape custom path. Preset conversion and unsupported
  geometry replacement fail with `unsupported-edit`.

The synchronous path validator admits exact own-data objects and dense arrays.
Unknown fields, accessors, coercible strings, fractional/nonfinite numbers and
unsupported commands fail. Formula strings are never evaluated. This validation
does not establish a sandbox for hostile JavaScript proxies.

Use `schema shapes paths add --json` for machine-readable options and
`shapes paths add --help` for command help. Common `--dry-run`, `--output`,
`--in-place`, selectors and JSON result/status rules apply. Dry-run validates the
proposed edit without publishing output. Units and object selectors mean the
same thing in SDK and CLI operations.
