# Image inventory draft

`pptx images list deck.pptx --json` reads slide-local image references. Use
`--scope layouts`, `--scope masters` or `--scope notes` to inspect those owners
explicitly. `--slide 2` selects a one-based slide; `--image 1` selects a picture
position within its owner. Background and shape-fill references are also listed.
`--image` filters pictures only; use scope or an owning shape token for fills and
backgrounds. `--slide` can filter notes/layout/master ancestry within those scopes.
`--scope shared` explicitly includes all drawing-owner scopes; it does not scan
binary media as XML. Notes-master and handout-master scopes are also available.

The result separates `occurrences` from `media`. Occurrences identify the owning
part, relationship, shape, scope, crop, alt text and placement. A shared resource
has multiple occurrences but one default media record per package part.
`--unique` explicitly groups media by SHA-256, retaining all original part names
and occurrence identities. Equal bytes do not imply one logical picture.
Only resources referenced within the selected scope are included; unused orphan
media parts remain available in general package inspection. Grouped resources
retain distinct MIME declarations in `contentTypes`, with `contentType: null`
when the declarations disagree.
Such mixed groups also report unknown intrinsic dimensions and default density.

Linked resources retain their source target and have no admitted bytes or hash.
They are never fetched. Vector and fallback references remain separate entries;
structural inventory is not a claim that every branch is displayed. Inherited
use records slide membership, not rendering or visibility after all overrides.

Intrinsic raster metadata is read from bounded headers without decoding pixels.
Unknown metadata remains absent rather than being guessed from the filename.
SHA-256 identifies admitted part bytes; any SHA-1 metadata is for compatibility
only. Placement is in EMUs; crop values are fractions and retain existing negative
or greater-than-one values.

The typed operation SDK accepts explicit bytes/streams or a capability-scoped
VFS input; it shares behavior with the CLI. This is inventory support, not image
insertion, extraction, replacement, rendering or complete picture-model coverage.
The retained model API names and remaining obligations are tracked separately in
the [research API receipt](image-inventory-api-map.json) and
[individual case accounting](image-inventory-case-map.json).

```ts
const inventory = await readImages(bytes, { scope: "slides", unique: true }, context);
```

`readImages` is exported by the private workspace package `pptx`. The caller
supplies a `SelectionContext` containing byte, archive, XML and relationship
limits and an optional cancellation signal. This draft does not promise a
published npm package.
