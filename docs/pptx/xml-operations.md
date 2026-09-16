# XML part operations draft

`pptx xml get INPUT --part URI` reads an existing XML part. The URI is an OPC
package identity, such as `/ppt/slides/slide1.xml`, not a filesystem path. Default
scope is slides; use an explicit scope for other owners. Inspection provides
fingerprinted selectors. Part creation and arbitrary archive extraction are
outside this operation.

Content-type and relationship metadata can also be read by exact existing URI
with explicit `--scope shared`, for example
`pptx xml get deck.pptx --part '/[Content_Types].xml' --scope shared`.
These reads report shared locations without introducing reusable selector tokens
for metadata. They do not enable metadata replacement.

Original mode emits the exact original XML bytes, including encoding and lexical
whitespace. `--pretty` emits an explicitly labeled display. Pretty XML is a
display representation, not original bytes or a preservation guarantee. `--json`
returns the common version-1 envelope with operation `xml.get` and a format label.

```sh
pptx xml get deck.pptx --part /ppt/slides/slide1.xml
pptx xml get deck.pptx --part /ppt/slides/slide1.xml --pretty
pptx xml set deck.pptx --part /ppt/slides/slide1.xml --file slide.xml --dry-run --json
pptx xml set deck.pptx --part /ppt/slides/slide1.xml --file slide.xml -o revised.pptx
```

Replacement is whole-part substitution with validation. Supply a complete XML
part. The replacement keeps the existing part identity and content type and must
meet the supported namespace, structure and graph constraints. Unrelated decoded
package entries retain their exact bytes. ZIP container bytes can change.
This command does not silently convert presentation dialects or repair resources.

The replacement profile admits presentation/main and slide parts, retaining the
existing expanded element names and child order. Text and supported attribute
changes can be supplied; resource relationship bindings and opaque payloads must
remain unchanged. Layout, master, theme, relationship and content-type parts are
not replaceable through this profile. Reads do not confer mutation support.

For XML operations, repeat `--limit NAME=VALUE` with distinct names to lower
`maxBytes`, `maxNodes`, `maxDepth` or `maxOutputBytes`. Values cannot exceed the
explicit host ceilings; output needs at least 512 bytes for bounded diagnostics.
The engine requires `context.validationLimits` in addition to its inspection
context before XML operations are available. No environment variable sets limits.

Mutation requires exactly one output destination or `--in-place`, except dry-run.
An existing output needs `--force`; an input alias requires `--in-place`. Force
never bypasses validation. `--output -` emits only the validated package bytes and
conflicts with JSON unless dry-run. Document input and replacement cannot both
consume stdin. Filesystem publication requires an explicit adapter with the
necessary atomic and stale-input guarantees; unavailable guarantees cause failure.

Signed, macro-bearing, protected and unsupported edits fail before publication.
Semantic checks do not claim complete OOXML schema validation, rendering or visual
fidelity. Use `schema xml get`, `schema xml set` and `capabilities --json` for the
implemented profile. Other proposed editing/model operations remain pending.

The typed package API exposes `getXmlPart(input, part, context, options?)` and
`replaceXmlPart(input, part, replacement, context)`. Inputs are bounded bytes,
byte sources or explicit VFS capabilities. The context supplies byte, archive
and validation limits plus optional cancellation. Reading returns owned original
bytes alongside a labeled XML string; replacement returns a validated package
byte array. Neither operation publishes to a host path implicitly. The public
command engine invokes these operations and delegates publication to its explicit
callback. These functions do not implement live model `element` or `part` views.
