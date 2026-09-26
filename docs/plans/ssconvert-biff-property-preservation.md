# Preserve OLE properties across BIFF edits

Status: source-derived merge implemented; delivery and qualification in progress. This is part of
hey-boss #1748 and does not close the format or encryption gap families.

Use LibreOffice revision `bce0998afefdbc355585ca324285661a2170ba77`.
Source URLs and verified hashes are recorded in
`docs/ssconvert/gap-resolution.json`, under `reference.biffDocumentProperties`.

The source establishes the binary layout but does not provide a preservation
algorithm. `oleprops.cxx:1037` omits unknown property types; its BLOB and thumbnail
loaders are unimplemented. `docinf.cxx:199` saves fresh property sets from the
document model. A native save therefore cannot certify opaque byte retention.

1. Extract the existing bounded section/property layout reader for reuse by the
   importer and exporter. Keep section-relative property offsets, absolute section
   offsets, overlap validation, cancellation and explicit resource limits.
2. Record which section and property ID supplied each modeled key. Reconcile that
   identity with current values: replace edits, remove explicit model deletions,
   and preserve unknown records and collisions. Do not confuse an undecoded value
   with a deleted modeled value. Compare original normalized values before
   rewriting precision-sensitive timestamps.
3. Copy opaque value spans and unknown sections exactly, including padding. Keep
   their section codepage: LibreOffice's unconditional UTF-8 rewrite is safe for
   its decoded objects, not for opaque string-bearing values. Encode new scalar
   strings as VT_LPWSTR where necessary.
4. Preserve custom dictionary IDs and names. Allocate new IDs without collisions.
   Encode additions only when their names round-trip exactly in the original
   codepage; the general text encoder's escape fallback changes identity. Retain
   explicit diagnostics for operations that still cannot preserve both the edit
   and opaque data. Do not mark those cases complete.
5. Reproduce loss with an original in-memory property stream containing a valid
   unknown value and a title. Edit and delete modeled fields, reexport, and inspect
   the raw property stream independently. Include a custom dictionary and an
   unknown section only where they exercise distinct source-derived constraints.
   Run maintained focused lint/types and the BIFF cohort after implementation.
6. Verify public CLI loss diagnostics and publication with a terminal screenshot.
   Commit source and concise evidence only; remove generated outputs from `out`.
   Deliver to remote main and monitor the containing GitHub release separately.

Encrypted ancillary streams remain a separate implementation requirement. Keep
the existing refusal until their cryptographic path is implemented and verified.

Current scope: new imports carry source identities. Legacy retained records without
those identities still warn. New dictionary names outside the original codepage
and edits that expose an opaque duplicate remain explicitly diagnosed. These
limitations and native application qualification remain open.
