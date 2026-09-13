# pptx architecture

Status: Proposed; documentation-only package-boundaries decision.

Implemented Through: Not applicable

Purpose: Define the smallest reusable packaging boundary and explicit runtime
capabilities for `pptx`, under the [format](../specs/pptx.md),
[CLI](../specs/office-cli.md) and [SDK](../specs/office-sdk.md) contracts.

## Inspected implementation

Repository revision: `20c8ed08c42a43742dc0298a721ca10469797890`.
The [review receipt](../plans/pptx-package-boundaries.md) records source hashes,
coverage accounting and original acceptance designs. These observations are source
inspection, not a new runtime qualification.

- `packages/safe-bash/src/commands/archive/zip-format.ts` already implements stored
  and deflated ZIP entries, CRC checking during decode, local/central agreement,
  signed/unsigned descriptors, metadata retention and bounded archive read/write.
  It rejects ZIP64 extras, sentinel sizes/counts and extraction versions above 20.
  `readZipArchive` retains compressed subarray views of the admitted input;
  `decodeZipEntry` must finish before its CRC/length checks establish validity.
- Its raw compression dependency is
  `packages/safe-bash/src/commands/bytes/compression/codec.ts`, using the declared
  `pako` 3.0.1 dependency. This path does not use the separate native compression
  bridges. The current dependency edges also include shell diagnostics,
  `contracts/index.ts`, scheduler helpers and archive `internal.ts`.
- `archive/internal.ts` combines byte limits with VFS helpers. Its `publish`
  writes directly through `writeStream` or write/append; it is not a transaction.
  The archive command export also brings tar/extraction command behavior. Neither
  that command barrel nor its publication helper is the SDK packaging boundary.
- `packages/safe-fs/src/xml.ts` already provides namespace-aware parsing,
  ordered content, attributes, comments/CDATA and processing instructions inside
  the root, bounded work steps and DTD/entity-declaration rejection. It normalizes
  line endings and entities and does not retain all lexical source spans or
  document-level miscellaneous nodes. It is not a lossless editing serializer,
  MCE processor or OPC graph implementation.
- `packages/safe-fs/src/contracts/filesystem.ts` exposes retained reads,
  conditional writes, staged files and conditional staged publication. Capability
  flags and optional methods must both be checked for the actual destination.
  Atomic rename alone does not prove content-version comparison or multi-file
  transactions.
- The agent-stash archive implementation uses host filesystem/OS/path and tar;
  its in-memory codec is a string-map test double, not a ZIP engine. Neither
  supplies a portable presentation package codec.
- No `docx` or `pptx` product workspace/source implementation was found in the
  inspected package inventory. The existing document-format audits are research.
  This decision requires no other plan to finish.

## Ownership and dependency direction

`packages/pptx` owns the presentation model, operations, PresentationML/DrawingML,
themes, charts and their bounded embedded workbook subset. It owns its command
schemas, domain errors and capability reporting. The safe-bash adapter belongs in
`packages/safe-bash/src/commands/pptx`; root only wires public exports and commands.
There is one domain editor behind model methods and typed operations.

The justified shared extraction is a small `packages/office-package` workspace
with independent ZIP, XML and OPC entrypoints. This is a proposed location, not
an existing import path or published dependency. Its ownership is limited to:

| Boundary  | Owns                                                                                                | Excludes                                                                          |
| --------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ZIP bytes | Central/local records, CRC, raw compression, bounded decode/write, retained metadata                | Shell commands, path extraction, VFS, publication, presentation types             |
| XML       | Bounded namespace-aware parse and preservation-aware serialization                                  | XPath execution, callbacks from document content, layout, format-specific schemas |
| OPC       | Canonical part identities, content types, relationships, graph closure and isolated graph mutations | Slides, paragraphs, styles, media rendering, arbitrary Office object framework    |

Extract and adapt the existing ZIP/codec implementation; existing archive commands
must consume the same engine. Do not fork its code into a second engine or call
`zip`/`unzip` through a shell. Add bounded ZIP64 reading in that engine under its
own explicit format profile; retain the existing command profile until separately
qualified. Lack of ZIP64 today justifies an extension, not duplicate engines.

Retain the XML parser as one implementation: expose a narrow portable entrypoint
from its current owner or relocate it with existing consumers redirected. Extend
its preservation representation where needed. Untouched parts retain original
bytes; a dirty part preserves unknown nodes, namespace bindings, order and required
whitespace. Re-serializing the current parsed tree alone is insufficient evidence.
OPC is new bounded graph logic here because no reusable implementation was found.
Both formats may consume it without importing one another's model. No abstract
document base class, generic style system or plugin framework is justified.

## Explicit capabilities and byte ownership

The public types remain those in the [API map](public-api-map.json), including
`BinaryInput = Uint8Array | ByteSource | VfsPath` and
`BinaryOutput = ByteSink | VfsPath`. The SDK `ByteSource.read(maxBytes)` returns
`Promise<Uint8Array | null>`; null alone means EOF. The shell's existing
`AsyncIterable<Uint8Array>` source is a different transport. The adapter owns
conversion, maximum chunk enforcement, empty-chunk progress accounting and
iterator cleanup; a type cast does not reconcile them.

Input bytes are copied on admission before yielding control or requesting another
chunk. Caller mutation and reused producer buffers cannot change the snapshot.
Returned bytes are copies, including part/media views. Internal compressed slices
may alias only an owned immutable snapshot. Save/load/input admission are always
async; model-only changes and fitting with admitted metrics are synchronous.
No `Buffer`, host file object or process stream is a required public value.

`VfsPath` carries its rooted capability. Plain strings never authorize host paths.
The adapter resolves relative paths only against the supplied virtual cwd, admits
each input once and binds its identity/fingerprint. Part URIs resolve only inside
the package graph. External relationships remain inert metadata, never fetches.
Trusted VFS implementations may perform their configured storage I/O; the product
has no network client, credential discovery or automatic backend construction.

Context supplies cancellation, ceilings, optional explicit UTC timestamp/author
and already-admitted font metrics. Metrics handles are bounded and owner-checked;
font paths, ambient font discovery and arbitrary user callbacks are not substitutes.
No hidden environment options, clock-derived metadata, random IDs, temporary host
directories or native runtimes. Scheduling yields are transport work, not a source
of document timestamps. Limits charge actual bytes, clones and aggregate graph
work across a whole diff/merge/batch; codec defaults do not override format ceilings.

## Publication contract

Admission, isolated mutation, graph validation and complete bounded serialization
precede publication. A failed prepublication operation has no destination effects.
`--dry-run` stops after semantic validation and publishes nothing.

| Destination                | Required authority and behavior                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Byte sink/stdout           | Await writes/backpressure and the declared completion boundary; do not close shell-owned stdout. Transport failure may follow partial bytes; no rollback promise. Binary output excludes JSON/progress.                  |
| New VFS file               | Explicit destination, protected staging and conditional no-replace commit; existing file needs force intent. Unknown capability fails closed.                                                                            |
| Existing VFS file/in-place | Conditional publication tied to the admitted content version and expected destination/parent identity. In-place rechecks source fingerprint and rejects aliases selected as ordinary output. Force does not bypass this. |
| Multiple files             | Adapter transaction covering the entire output set, or explicit `allowPartialOutput` with a precise published manifest on failure. Single-file staging does not imply directory atomicity.                               |

Existing `createStagedFile`/`publishStagedFile`/`removeStagedFile` and
`writeFileConditional` are candidate adapter primitives, not blanket proof of
these guarantees. The adapter must prove that its expected state detects a content
change even when inode identity survives. A separate fingerprint read followed by
unconditional rename is racy. If the backing store cannot protect the comparison
and commit, in-place publication is unavailable; report that in capabilities.
Cleanup is restricted to retained owned staging objects, never directory sweeps.
Cancellation before commit aborts staging; a confirmed committed output must remain
truthfully recorded if cancellation races completion. Preserve the primary failure
when cleanup also fails.

## Runtime closure and portable hosts

The intended runtime closure is `pptx` domain modules → narrow OPC/XML/ZIP modules
→ the existing raw deflate dependency and bounded portable byte primitives.
SHA-256 fingerprints and the public image SHA-1 metadata need bounded portable
implementations; use narrow existing hash exports after closure verification, not
an ambient crypto/network service. The repository declares `@noble/hashes` 2.4.0;
its mere presence is not a browser qualification. No new dependency is installed
by this decision.

The current archive imports are not an approved closure. Type-only filesystem
interfaces may be shared, but importing the broad safe-fs core barrel can include
unneeded filesystem/bridge modules. Deep imports of unpublished private modules
are not the final export contract. Separate byte engine and command entrypoints
must have explicit declarations and runtime exports with no shell dependency cycle.

Browser and workerd entrypoints must resolve without Node compatibility flags,
host filesystem/process/path modules, native/WASM converter assets or runtime
downloads. They use typed arrays, text encoders/decoders, UTC values, explicit
abort signals and a portable bounded scheduling path. No assumption of DOMParser,
window, Buffer, setImmediate or a particular compression-stream implementation.
The current codec's AbortSignal APIs and scheduling fallback require runtime
qualification; types and bundler success alone do not establish availability.
Byte-only use must not instantiate a VFS or filesystem backend.

Packed-consumer verification must cover actual transitive runtime imports, dynamic
imports, assets, licenses and browser/workerd export conditions. Research notices,
downloaded corpus bytes, reference checkouts and QA outputs are excluded from the
product runtime and package files. Required legal notices for substantial derived
material remain standalone. Dependency license notices remain with the relevant
distributed dependency; provenance never becomes product branding.

## Safe-bash and shared public contracts

The proposed adapter returns a `VirtualShellPlugin` registering one
`CommandDefinition` named exactly `pptx`. Registration rejects collisions unless
replacement is explicitly authorized. No automatic installation into unrelated
command groups. `CommandContext` contributes only admitted arguments, byte
streams, rooted VFS, cwd, limits, cancellation and owned cleanup. It does not grant
the domain editor `env`, arbitrary `invoke` or unrestricted host access.

Decode options with the shared schema before reading inputs and reserve stdin
for at most one consumer, including nested image/template/batch inputs. Dispatch
closed operation IDs into the same SDK behavior; never execute a property path or
evaluate JavaScript. `images`, `tables`, `properties`, `text replace`, common
selection/cardinality flags and version-1 JSON remain unchanged. Ordinary exit
statuses are 0/1/2/3/4/130; diff uses 0/1/2/130 with differences returned as data.
Schema describes the declared surface; capabilities reports implemented support
and actual host publication abilities, never all planned rows as available.

Neutral model spellings, direct properties and J01–J10 language/security mappings
remain authoritative. This architecture does not rename model members to command
spellings or hide inherited/underscore-prefixed types. Noncreating CLI queries
remain separate from creating model accessors. All 2,407 source API records and
17 bounded-view additions retain their target obligations, including untested APIs.

## Conformance evidence and limits

The [case ledger](test-case-map.json) remains the sole per-source adaptation ledger:
2,700 unit cases, including 2,057 parameter variants, plus 973 expanded BDD cases.
Architecture reuse does not discharge any row. All 391 counterpart packaging/image/
XML obligations remain separate until behavioral equivalence is demonstrated.
The [review receipt](../plans/pptx-package-boundaries.md) adds original small
boundary designs without claiming passing tests or rerunning the pipeline.

The [corpus manifest](corpus-manifest.json) governs disposable QA fixtures. Corpus
availability and past census results do not establish product conformance. Unit
tests use independently authored in-memory bytes/memfs and require no downloads.
QA procedures and future runtime/visual qualification remain in `docs/plans`.
Usage documentation stays in `docs/pptx` pending README permission.
