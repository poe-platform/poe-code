# behavior-soffice: bounded CSV text increment

Status: incomplete; the whole acceptance matrix remains open.

Implemented `exportCsvTextRows` in the private, dependency-free TypeScript ESM
command package, exported through its existing composition-only safe-bash subpath.
This is an engine primitive, not an executable soffice handler or Office workbook
adapter. No capability flag was changed.

Started with failing tests (missing export), then implemented UTF-8 text rows,
separator/quote/CR/LF escaping, literal quote doubling, quote-all, optional BOM,
custom BMP delimiters and LF row termination. A separately reproduced dollar-quote
replacement bug was fixed with a literal replacement callback. Formula-looking
strings stay inert. Incomplete options, fixed width, space removal, malformed
Unicode and unsupported encodings/delimiters fail explicitly. Numeric display/raw,
error/edit-cell and formula semantics are outside this text-only contract.

Accounting charges caller-owned cell text as UTF-8 input bytes; there is no byte
parser or newly decoded document storage in this primitive. Row/intermediate text
uses conservative UTF-16 reservations, including reference slots; encoded rows are
reserved before allocation. Nodes and scanning/escaping/encoding work are charged.
Export settings are snapshotted before yielding so caller mutation cannot alter
the admitted profile. Output bytes are cumulative and charged before allocation. Retained row reservations
are released before yielding, transferring the byte buffer to the consumer. Failures
roll back only this call's memory. Cancellation and closed ownership are checked at
entry, per row/cell/character and completion; there is no recursion. Later failures
may follow earlier chunks, so consumers must stage and discard invocation output
rather than publish chunks as completed conversions.

38 memory-only workspace unit tests pass, including nine new serializer tests.
Workspace lint and production/test TypeScript checks pass. The selected command
build and safe-bash workspace build closure pass. No visual CLI behavior changed,
so no screenshot qualification is claimed. No native Office conversion, geometry,
PDF standard or independent charset-map evidence was obtained.

Review found no host I/O, subprocess, network, dynamic dependency, native/WASM or
browser fallback in the added implementation, and no proxy-only API. The package
manifest remains private with no runtime dependencies. Unrelated edits were
preserved. No commit, push, release or publication was performed.

## Findings blocking completion

C04 quoting/UTF-8/BOM has implementation-level text-cell tests only; C04 as a whole
remains open pending workbook adapters, other encodings and independent controls.
All other C groups remain open. No original acceptance cell is closed by this
increment. ODF/OOXML containers, loss-preserving models, bounded formula semantics,
VFS batch staging/alias preflight/atomic publication and an executable CLI/SDK
conversion handler are missing. Supplied-font shaping/pagination/table/footnote
layout, deterministic typed PDF settings and independently verified PDF/A/UA
profiles remain missing. Original-document screenshots and native qualification
remain unavailable. Installed-consumer runtime/declaration verification must be
renewed for this new API; the workspace build does not establish installed parity.
These findings block completion of behavior-soffice.
