# ZIP byte codec draft

The private `@poe-code/office-package` workspace contains the shared ZIP and
compression implementation used by the shell archive commands and the internal
`pptx` package reader. It is not a separately published install recommendation.
`pptx` does not yet expose `Presentation`, a CLI command, operation schemas or
capabilities. Its internal byte reader is not the public OPC graph view.

The package exports `createZipCodec`, `crc32`, codec types and
`createCompressionCodec`. ZIP-specific imports are available through `/zip`;
compression imports through `/compression`. There are no environment variables,
filesystem paths, network clients, native converters or implicit author/time inputs.

`createZipCodec(runtime?, profile?)` returns `readZipArchive`, `decodeZipEntry`,
`makeZipEntry` and `writeZipArchive`. When supplied, the runtime provides `yieldTurn(signal)`, `fail(message)` and
`compression` (a compression codec/reader pair). Profile options are `zip64` (default false),
`rejectDuplicateNames` (default false), and `utcDates` (default true). The internal
presentation reader sets all three to true. Existing shell commands keep classic
ZIP admission and local DOS-date interpretation.

All ZIP methods take explicit `ZipLimits` and an `AbortSignal`. Limits are byte
counts except `maxMembers` (entry count) and `maxDepth` (path segment count):

| Option            | Bounds                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `maxArchiveBytes` | Input/output compressed archive size                                                       |
| `maxEntryBytes`   | Declared and actual decoded bytes per entry                                                |
| `maxTotalBytes`   | Declared aggregate decoded bytes; callers consume all entries to establish actual validity |
| `maxMembers`      | Central-directory entry count                                                              |
| `maxPathBytes`    | Encoded entry-name bytes                                                                   |
| `maxDepth`        | Entry-name path segments                                                                   |
| `maxPaxBytes`     | Retained ZIP extra-field bytes per record                                                  |
| `maxTextBytes`    | Archive/entry comments and Unicode comment payloads                                        |
| `chunkSize`       | 512–1,048,576 requested bytes; internal processing caps chunks at 65,536                   |

Limits must be nonnegative safe integers; the internal presentation reader
requires positive ceilings. ZIP64 fields are read only when enabled;
wide values must fit the configured ceilings and JavaScript safe integer range.
Archive and entry allocations remain below the existing classic 32-bit allocation
ceiling even with wide metadata. ZIP64 writing is not implemented. Read metadata
removes consumed ZIP64 extra fields while retaining unknown extra fields, allowing
classic reserialization of small inputs. Encryption and multi-disk archives fail.

`readZipArchive` snapshots its input before yielding and returns compressed entry
bytes. A successful directory read alone does **not** validate entry CRCs.
`decodeZipEntry` must be consumed to completion: checksum, exact expansion length,
and trailing-compressed-data checks can fail after yielded chunks. Callers must
stage those bytes until validation completes. The internal `pptx` reader does
this for every member before returning any part, then returns fresh byte copies
on lookup. It rejects symlinks, unsafe logical names and colliding part identities.
XML, content types and relationships are still opaque bytes at this boundary.

`createCompressionCodec(runtime?)` exposes a reader with `chunk`, `restore` and
idempotent asynchronous `close`, plus a streaming codec. Options are `mode`
(`gzip`, `gunzip`, `inflate-raw`, `deflate-raw`), `chunkSize`, `level` and
`onFailure`. Its optional runtime supplies all three hooks: `yieldTurn(signal)`,
`readBytes(source, signal)` and `diagnostic(error)`. The caller owns and closes the reader; stopping codec output does
not close a borrowed reader. The reader retains unread compressed suffixes for
the same input stream. Output chunks remain stable across subsequent pulls.

`crc32(bytes, previous = 0)` supports incremental checksums. The default runtime
throws `CodecError` with `invalid-package` or `resource-limit`; the internal
presentation reader maps failures into the shared `OfficeError` contract.

The package has been exercised through an offline packed consumer and browser-
conditioned bundling in an isolated JavaScript context without `process` or
`Buffer`. This is not certification of a deployed browser or workerd host.
See [the implementation receipt](../plans/pptx-zip-reader.md) and
[case accounting](zip-reader-evidence.json) for exact evidence and remaining work.
