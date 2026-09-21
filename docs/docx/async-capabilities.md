# DOCX asynchronous capability mappings

The `sdk-async-capabilities` task qualifies the async boundaries of the existing
live model, rather than a second editor. Its [receipt](async-capabilities.json)
records original tests, pinned source rows and maintained checks. The
[factory ownership receipt](async-factory-ownership.json) records the reproduced
package admission race separately. Whole-public-API acceptance, source-case
adaptation and later tasks remain pending.

`Document` and `PackageView.open` capture caller bytes and input capabilities
before suspension; stream chunks are copied before advancing the source. Document
omission/null creates the original authored template; package open requires an
input. Image factories, picture insertion, story/package/image-collection image
admission and byte-bearing part loads always return Promises, including errors
and already supplied bytes. Admitted getters, formatting, unit conversions,
collections and model-only creation remain synchronous. Input byte/chunk copies
and method receivers are retained; no host path, native document runtime or
implicit network authority is granted.

`DocumentModelContext` retains typed timestamp, author, initials, metrics,
cancellation, limits and cooperative cleanup. Omission uses the fixed UTC instant
1980-01-01T00:00:00Z, empty identity strings, intrinsic documented ceilings and
an intrinsic un-aborted signal. Metrics remain absent unless explicitly supplied;
no fonts are discovered. UTC timestamps are copied and normalized to whole seconds.
Invalid explicit values/accessors reject asynchronously through admission. Creation
uses context author; comment method arguments retain their documented empty
identity defaults instead of silently substituting context author.

Save accepts `DocumentModelOutput = ByteSink | ArchiveSink | DocxVfsPath` on the
Document, DocumentPartView, PackageView and the existing style model. `ByteSink`
is the typed `stage(signal?) -> Promise<StagedByteSink>` protocol. An acquired
stage has asynchronous write/commit/abort methods. Serialization and owner checks
precede stage acquisition; failed write/commit and cancellation before commit
abort the acquired stage. Abort failure retains both errors. A successful commit
receipt wins over cancellation arriving afterward. The compatible ArchiveSink
write(bytes, signal) protocol remains available for nontransactional streams;
publication errors conservatively retain the shared possible-partial-stream flag.
Sink methods are captured before serialization and accessors are never executed.

A VFS save path carries an explicit token matching
`context.vfs = { capability, filesystem }`. The adapter must implement the shared
conditional owned-staging guarantees. Save exclusively creates a destination;
existing destinations reject. This is a deliberate security mapping of the
source's unrestricted overwrite behavior. Explicit force/in-place overwrite
continues through the shared publication operation/CLI contract, not an implicit
save default. Input VFS paths retain the existing matching binaryResolver contract.
No path string alone grants authority. VFS capability/path values are captured,
while the explicitly supplied adapter retains its authority and responsibility
for conditional publication.

CLI output flags and final batch publication use this same package publication
engine. Plural resources, preserving text replace, scopes/selectors, versioned JSON,
exit categories and schema/capabilities remain unchanged and independently checked.
Serialized callbacks and nested batch publication remain disallowed; publication
belongs to the outer operation. The historical whole-API observations are corrected
only for the save forms now qualified here. Inherited members, helpers, enums,
collections, untested APIs and documented underscore-prefixed types keep their
separate behavioral obligations; none is hidden or counted as whole-API parity.
