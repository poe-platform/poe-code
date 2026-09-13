# Connectors

Draft usage for the bounded `pptx` connector operations. This is workspace
functionality, not a separately published package or complete live presentation
object model. Shared API and case accounting is recorded in
[the API receipt](connectors-api-map.json) and
[the case receipt](connectors-case-map.json).

`connectors list/get/add/set/remove` operate on slide-local connectors. Discover
exact options using `pptx schema connectors add --json`; `pptx capabilities --json`
reports editable and preserved subsets.

```sh
pptx connectors list deck.pptx --slide 1 --json
pptx connectors add deck.pptx --slide 1 --kind STRAIGHT --begin-x 1in --begin-y 1in --end-x 3in --end-y 2in --output connected.pptx
pptx connectors set connected.pptx --slide 1 --shape "Connector 8" --end-x 4in --output moved.pptx
```

Use the actual connector name or current location token from inspection; the
example name is illustrative. Shape labels must resolve uniquely. Ordinal slide
positions are one-based, connection sites zero-based. Tokens and target locations
belong to the acquired input fingerprint and must be refreshed after publication.

`--begin-target` and `--end-target` accept an inspected JSON location. Supplying
`--site` connects both explicitly supplied targets to that site. An attached end
stores the target object ID and site independently from its current coordinates.
Rebinding replaces the existing target rather than accumulating connections.
Coordinates alone create free ends. Changing an attached end to free coordinates
requires explicit detachment; passing JSON `null` for its target detaches that end.
`--detach-policy detach` detaches both ends, preserving their current coordinates.
`--detach-policy remove` on connector set removes the selected connector.

```sh
pptx connectors set deck.pptx --slide 1 --shape "Route" --begin-target "$TARGET_LOCATION_JSON" --site 3 --output attached.pptx
pptx connectors set attached.pptx --slide 1 --shape "Route" --begin-target null --begin-x 2in --output detached.pptx
pptx connectors remove detached.pptx --slide 1 --shape "Route" --output removed.pptx
```

Deleting a referenced target requires explicit connector detach/remove policy;
complex timing or unsupported references still reject. Use `shapes remove` with
`--detach-policy detach` to keep affected connectors at their stored coordinates,
or `--detach-policy remove` to remove affected connectors with the target. The SDK
equivalent is `removeShapes(bytes, { ...selection, detachPolicy }, context)`.

Targets must belong to the owning drawing. Rectangle, ellipse and rounded
rectangle shape/picture presets support sites 0–3 in top, left, bottom, right
order. A top-level connector can attach to a target nested inside transformed
groups. A connector inside a group can attach only to a sibling target in that
immediate group. Custom site formulas and other target presets reject. Group
projection rounds the final site coordinate once. Nonzero-rotated connectors
reject endpoint coordinate or attachment changes; independent style edits retain
their geometry. Existing unsupported connector geometry is
retained during supported independent edits, and unsafe geometry replacement
fails. Creating STRAIGHT, ELBOW and CURVE does not promise arbitrary routing,
control-point or adjustment editing.

All lengths require explicit units. `--line-width` accepts a nonnegative length
or `null` to clear the override. `--line-color` accepts six hexadecimal digits,
`solid` for a solid fill (retaining an existing solid color), or `null` for no
stroke. `--name` updates the connector label.
Mutations require `--output` or `--in-place`; `--dry-run` validates without
publication. `--json`, errors, exit statuses, bounded selection and publication
follow the common Office CLI contract. Read operations do not create definitions.

The same domain behavior is available through async SDK operations
`readConnectors`, `addConnector`, `mutateConnectors` and `removeConnectors`.
Mutation options put connector fields inside `update` using camelCase
(`beginX`, `beginTarget`, `lineColor`, `lineWidth`). Input bytes, I/O, limits and cancellation
come from the caller. In-memory model properties retain neutral snake_case
spellings where exposed; operational parity does not establish missing live
`SlideShapes` or `GroupShapes` collections.

The bounded `Connector(xml, shapeId?)` model owns an XML snapshot and exposes
`begin_x`, `begin_y`, `end_x`, `end_y`, `begin_connect`, `end_connect`, common
geometry, mutable `name` and live `line` formatting. Target element views must
come from its current snapshot and must be refreshed after a mutation. Length
properties use `Length` values; inspect their `.emu` property for integer EMUs.
This snapshot model does not provide the full document-owned shape collections.

`MSO_CONNECTOR_TYPE` retains STRAIGHT=1, ELBOW=2, CURVE=3 and MIXED=-2;
`MSO_CONNECTOR` is the same frozen definition. Numeric symbols use
`metadata(value)` for immutable `name`, `value` and `xml_value` records.
`from_xml`, `to_xml` and `validate` provide bounded conversion; MIXED is a
read sentinel that cannot be created or serialized. Existing `straightConnector1`
reads as straight and remains unchanged during independent style edits.
