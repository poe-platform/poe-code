# Curie review only: minimal real-provider integration

Use the existing optional FileSystem.compareEntry seam first. An embedding host
can attach a metadata-only authority to its WebDAV adapter that recognizes an
actual configured peer/path mapping. Query both actual followed resources,
preserve signal/errors, compare their genuine shared identity, and return unknown
for unrecognized peers. Do not recurse through comparison negotiation.

For HTTP-only peers, retain RFC5842 resource-ID comparison where supported. It
does not establish disjointness from local Memory/Real or unrelated SDK stores.
Serialized metadata without recognized backing provenance stays unknown.

If SDK users require constructor injection rather than an adapter override, Curie
could review one optional comparison callback with the SAME existing compareEntry
arguments/semantics. It would assert a real provider-owned namespace/path mapping,
not grant permission to copy unknown resources. No general registration table,
trust boolean, client scope or URL-based disjointness is needed.

Any future transport metadata binding must associate a fresh operation response
with its actual followed backing and require remappers/caches to drop or truthfully
rebind it. Validate with a real local-backed gateway alias and an unrelated peer,
including denied/missing/cancel/conflict cases, before claiming SDK interoperability.
No such new API or generic SDK support is implemented by this checkpoint.
