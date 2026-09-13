# Connector and group owner models

The connector model accepts an optional synchronous XML owner as its third constructor argument: `new Connector(xml, shapeId, { read, write })`. Reads resolve the owner's current drawing; mutations publish only the complete validated result. Cached line/shadow handles keep reading that owner. Without an owner, the existing detached XML behavior remains available.

`begin_connect(shape, connectionSiteIdx)` and `end_connect(shape, connectionSiteIdx)` retain neutral spellings. The target must expose an XML element belonging to the current drawing. Stale/foreign elements, self-targets, fractional/negative/out-of-range sites, unsupported geometry and unsafe cross-group attachment are rejected before publication by the existing connector engine. Site indices are zero-based JavaScript integers. The supported rectangle, rounded rectangle and ellipse sites retain top/left/bottom/right ordering. Binding retains explicit attachment XML and updates endpoint geometry.

`Shape(xml, { read, write })` provides shared synchronous owner binding to inherited geometry and text/format handles. Picture and graphic-frame roots are accepted for specialized subclasses. Nonvisual metadata setters on non-text drawing objects merge their existing identity properties without replacing children.

`GroupShape<Children>(xml, children, owner?)` exposes the stable injected `shapes` collection, `shape_type` GROUP, and inherited `shape_id`, `name`, geometry, rotation, shadow, placeholder capability and content-capability properties. Group click actions synchronously raise the SDK `TypeError`, reconciling the inventory's misleading ActionSetting return annotation with its documented rejection behavior. `has_text_frame`, `has_chart`, and `has_table` are false. Group collections are composed by the slide model; the generic itself grants no package or I/O authority.

Original tests: `connectors-model.test.ts`, `connector-public-surface.test.ts`, and `group-model.test.ts`. Added cases reproduce disconnected owner mutations before implementation and verify shared reads, both binding ends, atomic invalid-site rejection, group identity/geometry, stable children, metadata preservation and click/text rejection. XML is original and held entirely in memory, so no filesystem mock is needed.

This receipt does not claim whole inventory completion. Returned group collection insertion/iteration, slide-package ownership and related API integration belong to the slide graph receipt. It does not reclassify underscore-prefixed inventory types as private or treat absent source tests as exemptions.

## Rich insertion command mapping

`images add`, `tables add`, and `charts add` accept `--slide N --placeholder IDX`. Slide positions remain one-based; idx is a sparse unsigned 32-bit key. The typed `insertPlaceholder(input, { slide, placeholder, content }, context)` operation and the CLI call the same live insertion members. The insertion retains shape ID, idx and z-order and emits the existing operation's publication and JSON envelope. Explicit geometry and fit are incompatible with placeholder selection. This explicit owner/key path does not accept opaque selection tokens.

The current table branch accepts only rows and columns; the chart branch accepts type and data. Unsupported simultaneous styling/data overrides are rejected before document reads instead of ignored. Picture placeholders accept complete PNG/JPEG bytes, cover-fit the inherited box, validate declared content type against bytes, and map optional alt text to description. This intentionally narrower picture profile is disclosed in help; ordinary image addition retains GIF support.

`command-placeholder.test.ts` verifies all three commands using original memfs presentations, sparse idx 10, ID retention, atomic argument failures and emitted schemas. Closed stored-data options, kind discriminants, key bounds and content metadata are validated by the exported helper. No file path access or network is granted to the model helper; CLI reads and publication remain explicit capabilities.

## Independent live-owner review

The original `slide-owner-regressions.test.ts` exposed a real integration defect: a live shape's bounded subtree element is reparsed and therefore is not reference-identical to its element in the complete drawing. Connector binding now resolves such targets only when the internal XML owner token matches the connector's drawing. This restores live sibling binding without permitting a foreign same-ID shape. Existing direct XML bindings retain strict current-node identity checks.

The same review added independent row-proportional table-height, recursive group-bound and retained group-rotation checks. These assert public outcomes rather than implementation call paths. The row-height assertion uses proportionality documented in the API register; it does not assume an unverified exact default from a disposed research checkout.
