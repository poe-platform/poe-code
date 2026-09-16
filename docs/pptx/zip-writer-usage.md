# ZIP writer development notes

The current byte writer is internal to the `pptx` workspace. There is no supported
public import or CLI route for it yet. These are integration notes, not released
Presentation API documentation.

`writePackageArchive(members, context, options)` always returns a
`Promise<Uint8Array>`. Each member supplies a relative ZIP `name` and `bytes`.
The list is the complete desired output: source entries omitted from it are not
written. Empty lists produce empty ZIPs, not valid presentations. This layer does
not generate content types, relationship XML or PresentationML.

`options.compression` is required: `store` writes new payloads without compression;
`auto` uses the shared codec's level-6 raw deflate only when smaller. Both preserve the compression of
unchanged members when `options.source` is supplied. Source input accepts bytes,
a pull source or an explicit capability-scoped path, like the internal reader.
All source CRCs and sizes are verified before returning output, including entries
omitted from the final list. There is no ambient path resolution or network.

`context` requires byte limits and archive limits and accepts an AbortSignal.
The output must fit both `limits.maxBytes` and `archiveLimits.maxArchiveBytes`.
Decoded entry and cumulative byte ceilings are separate from the encoded output
ceiling. All member data is copied before the first asynchronous turn. Cancellation
rejects with `OfficeError` code `cancelled`; no partial byte result is returned.

Entries are ordered by exact JavaScript string comparison, without locale rules.
New entries use 1980-01-01 UTC. Original names/metadata and compressed member bytes
are retained when possible. Descriptor input is rewritten with complete local
headers. Output uses classic ZIP records: at most 65,534 members, 65,535 UTF-8
name bytes and values below 32-bit ZIP64 sentinels, subject to lower host ceilings.
Unsafe names, duplicate exact names and new directory entries are rejected.
OPC identity and graph validation remain separate work.

An existing explicit byte sink can receive the fully staged result using
`writeBinary`. Sink failure cannot undo bytes already accepted by that sink.
Atomic filesystem replacement and the public `save` operation remain unimplemented.
Unmodified member payloads remain exact after edits; container byte identity is
not promised. No environment variables are read by this writer.
