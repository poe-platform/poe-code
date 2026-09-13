# Presentation inventory draft

The current `readSelectionIndex(input, context)` SDK result includes `inventory`.
The configured `pptx inspect INPUT --json` command exposes the same inventory in
`data.inventory`; selectors narrow `data.records`, while inventory describes the
whole admitted presentation. Inputs require bytes or explicit VFS authority and
explicit byte/XML/relationship limits. No file, network or native runtime is
discovered implicitly.

- `slides` follows the presentation slide list, retaining slide IDs, owning part
  URIs, one-based inspection positions and slide-local drawing-object counts.
  Layout/master/theme fields follow single internal relationship links; missing
  targets are null. Multiple links for one inheritance role fail as ambiguous.
- `masters`, `layouts` and `themes` contain unique existing relationship targets
  sorted by part URI. They include shared owners, not slide-local shape content.
  The complete `relationships` array retains local IDs, owner URIs, original
  target strings, external markers and resolved internal targets. Cycles remain
  graph edges; inspection does not recursively expand them.
- `parts` contains OPC payload parts, excluding the content-type manifest and
  relationship metadata parts. Each includes content type (or null if unavailable),
  byte count and SHA-256. `media` contains unique media parts identified by content
  type or standard media relationships, including unreferenced media with a known
  media content type. This is not an occurrence/image-dimension/DPI inventory.
- `show.explicit` is null when absent and otherwise preserves true/false.
  `show.effective` applies the slide visibility schema default of true. Malformed
  Boolean values fail. Other effective formatting is not implemented.
- `unsupported` records semantic content not inspected for each part, unavailable
  content types and external/dangling relationships. It is deliberately a coarse
  limitation inventory, not a complete per-element feature classifier.
- `features` reports structural and visibility reading; editing, media metadata
  interpretation and effective formatting are false. The command's `schema` and
  `capabilities` describe the current result and supported subset.

`counts.slideShapes` counts addressable drawing objects in the ordered slides,
including groups and descendants. Notes/master/layout shapes are excluded. Opaque
unsupported nodes remain represented by their part inventory; they are not counted
as recognized drawing objects. All arrays/records are immutable. Inventory order
is independent of ZIP entry order; byte fingerprints intentionally change when
archive bytes change. Reusable selector tokens remain fingerprinted identities.

This inspection view does not implement the proposed live `Presentation` model,
its inherited members, enums, collections or mutators. Existing API and case
registers retain those obligations. No full format/API coverage is claimed.
