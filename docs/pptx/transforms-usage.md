# Shape transforms (draft)

`shapes set` accepts position, size, rotation and explicit horizontal/vertical
flips. It supports text boxes, presets, pictures, connectors, graphic frames and
groups. Other property edits on those additional object kinds remain unsupported.

```sh
pptx shapes set deck.pptx --slide 1 --shape Panel --left -0.5in --top 1in --width 2in --height 1in --rotation 90 --flip-horizontal true --flip-vertical false --output changed.pptx
pptx shapes get changed.pptx --slide 1 --shape Panel --json
```

The byte SDK uses `mutateShapes(bytes, {slide: 1, shape: "Panel", update:
{left: new Inches(-0.5), rotation: 90, flipHorizontal: true}}, context)` and
`readShapes(bytes, selection, context)`. The existing `Shape` model retains
`left`, `top`, `width`, `height`, `rotation`; `flip_horizontal` and `flip_vertical`
are boolean extensions. Its constructor currently represents standalone `sp`
elements; full live presentation/subclass model coverage remains incomplete.

Positions may be negative. Width and height must be positive after conversion.
Lengths round once to integer EMUs, nearest with ties away from zero, and admit
the same ±27273042316900 bound in SDK and CLI. Angles must be finite degrees in
[-360000,360000]; signed angle units round before modulo normalization. Omitted
properties remain unchanged; explicit false clears a flip. Strings and null are
not boolean values.

Placement is relative to the immediate parent. A group edit preserves its child
coordinate origin/extents and child shapes. `geometry.coordinateSystem` identifies
the stored placement space; `geometry.corners` always reports slide-space EMUs.
Corners retain their original box order after flips and clockwise center rotation.
Ancestor child origins, scales, flips and rotations compose outward before final
half-away rounding. Quarter turns use exact axis operations; other angles use
JavaScript trigonometric precision. `geometry: null` means explicit geometry is
missing; inherited placeholder placement is not inferred. Zero group child
extents and unsafe projected values fail projection.

`readShapeGeometry(root, node)` exposes the same bounded projection for an admitted
XML drawing. The node must belong to that root. `schema shapes set`, `schema shapes
get` and `capabilities` describe the supported command surface. Group/ungroup,
arbitrary path vertex transformation and full model subclass parity are separate
requirements and are not claimed here.
