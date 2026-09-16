# OLE byte insertion receipt

`addOleObject(input, options, context)` is an always-async package operation. Its
options are `slide`, `bytes`, `progId`, `iconBytes`, `iconContentType`, optional
`left`, `top`, `width`, `height`, `iconWidth`, `iconHeight` and `name`. Bytes are
copied before asynchronous package acquisition. The slide position is one-based.
All geometry is bounded integer EMU. Left/top default to zero. Frame dimensions
default to 914400 EMU (1in) per axis for string program identities and the registered
enum width/height for `PROG_ID` values. Explicit dimensions override those defaults.
Icon dimensions fall back to explicit frame dimensions, native dimensions, then
the default frame dimensions when native dimensions are unavailable.

The caller supplies a nonempty inert object payload, program identity and admitted
image bytes. These are packaged without execution, recursive object parsing,
filesystem discovery, subprocesses, network access or a hidden default icon.
Payload admission means bounded opaque storage, not semantic verification of an
OLE compound file or validation that the program identity matches its contents.
No integrity guarantee comes from the declared program identity.

String identity insertion writes an OLE content-type part, internal `oleObject` relationship,
internal icon image relationship, graphic frame, embedded object declaration and
nested picture. `showAsIcon` is true. The operation preserves the deck dialect,
retains unrelated parts and validates the resulting package before returning it.
Independent sequential insertions allocate separate media/object/shape identities.

## Exact mapping and remaining boundaries

The source `object_file`/`icon_file` path-or-stream inputs map to explicit owned
`Uint8Array` bytes. Implicit installed application icons map to required caller
icon bytes; there is no host lookup. The neutral `prog_id` model spelling maps to
camelCase `progId` in the versioned operation surface. Native model return values
remain the live graphic-frame owner's responsibility, including `ole_format`,
`blob`, `prog_id`, `show_as_icon` and inherited `element`, `parent`, `part`.
These are public obligations even though the source returned type starts with an
underscore. This receipt does not claim those interfaces solely from insertion.

Registered `PROG_ID.DOCX`, `.PPTX` and `.XLSX` identity objects select a `package`
relationship, the corresponding macro-free Office content type and `.docx`, `.pptx`
or `.xlsx` extension declaratively. Enum width/height supply frame defaults.
Lookalike objects are rejected without reading their properties. Explicit strings,
including strings equal to registered application program IDs, retain the opaque
OLE `.bin` path. Payloads are preserved without package recursion or execution;
declared type is caller metadata, not verification of inner bytes. Implicit default
icons remain an explicit caller-capability mapping. Group insertion
is handled by the model owner or remains explicitly unsupported; this domain
operation inserts at slide scope.

The relevant pinned source cases are the slide-part embedded-object variants,
base group shape `add_ole_object`, OLE element creator relationship case, three
shape-guide insertion variations, and the returned graphic-frame/OLE-format cases.
The inventories provide no independent decoded publisher-fixture geometry receipt;
this implementation uses original synthetic bytes and explicit geometry instead.

## Verification

`ole-insertion.test.ts`: 19 original cases passed in 160 ms (377 ms process duration).
Cases cover payload and icon byte preservation/ownership, declared program name,
icon/frame sizing, correct graphic-data URI, unrelated-part retention, independent
allocation, inventory and exact extraction, unknown dimensions with explicit box,
invalid inputs and accessors, byte ceilings, cancellation, missing slide selection,
Strict namespace preservation, all three enum package identities/types/defaults,
square string frame defaults and getter-free rejection of enum lookalikes. All archive persistence is in memfs.

Focused ESLint and package test TypeScript checks passed for all 19 cases;
final maintained package checks are performed by the root owner.
There are no downloaded documents, generated fixture files, native runtime calls
or cleanup obligations from this work.
