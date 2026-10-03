# @poe-code/office-package

Private ESM workspace providing shared ZIP and compression codecs for Office
packages. It has no standalone CLI or public installation promise.

```js
import { createCompressionCodec, createZipCodec } from "@poe-code/office-package";

const compression = createCompressionCodec();
const zip = createZipCodec();
```

`@poe-code/office-package/zip-sync` provides `readZipArchiveEntries` and
`createStoredZipArchive` for synchronous, already buffered office document
fast paths. It does not import spreadsheet codecs or PDF rendering. Use the
streaming codecs with explicit limits for untrusted or large archives.

## Configuration

There are no environment variables or configuration files. Callers supply byte
sources, AbortSignals and explicit resource limits; codecs acquire no filesystem
or network access.

`createCompressionCodec(runtime?)` accepts a runtime with `yieldTurn`, `readBytes`
and `diagnostic` hooks. Its `codec(input, options, signal)` takes `mode` (`gzip`,
`gunzip`, `inflate-raw`, or `deflate-raw`), optional `chunkSize`, compression
`level`, and `onFailure` callback.

`createZipCodec(runtime?, profile?)` accepts runtime `yieldTurn`, `fail` and
`compression` hooks. Profile options are `zip64`, `rejectDuplicateNames`,
`utcDates`, `validatePayloads`, and `allowStoredCompressionFlags`. The last option
accepts harmless compression-level hints on stored entries from producers such as
Pandoc; the default profile remains strict. ZIP operations require `ZipLimits`:
`maxArchiveBytes`, `maxEntryBytes`, `maxTotalBytes`, `maxMembers`, `maxPathBytes`,
`maxDepth`, `maxPaxBytes`, `maxTextBytes`, and `chunkSize`.
`readZipArchive` accepts either buffered bytes or a `ZipSource` with `size` and
`read(position, maxBytes, {signal})`. A source must refer to one stable object;
keep its retained filesystem handle open until all returned entries are consumed,
then close it on success or failure. The codec reads metadata and streams member
payloads on demand, handles short reads, and copies responses before another read
can reuse the buffer. Range reads are capped by `chunkSize`. Directory metadata
is retained per member by the convenience overload. Pass a fourth argument,
`{storage, onEntry}`, to scan with caller-backed name/span indexes and receive
`{members, comment}` instead. `storage` allocates positive scratch addresses and
provides exact reads and writes through a bounded cache. Each `onEntry` is awaited;
its entries are provisional until the scan resolves, so stage external effects
until final directory validation. The caller owns and closes the source and
scratch storage on success, cancellation and failure.

`createStoredZipEntries(createStorage, source)` keeps member decode records and
name lookups in that scratch storage. Pass its `storage` and awaited `set(entry)`
to a directory scan, then use `get(name)` to retrieve a member for decoding and
`close()` to retire the index. Retained reader entries expose `dataOffset` beside
`compressedSize`; payloads remain in the stable source. This index requires owned
source responses and preserves decode metadata, not archive rewriting extras or
comments. Backend failures carry their original cause in `ZipStorageFailure`.

`decodeZipEntry` also accepts a `ZipStreamEntry`: supply `data` as an async byte
stream (or a `(signal) => stream` factory) and `compressedSize` alongside the usual
member metadata. Range-backed entries use factories so each decode cancellation
reaches pending reads. The stream may
read a retained range from the caller's injected filesystem; the codec itself
opens no files. Decoding checks the compressed length, decoded length and CRC,
returns owned bounded chunks, and closes the input on cancellation or early return.

`createStagedWriter(storage, limits, signal)` writes member payloads and central
headers to caller storage instead of retaining an archive-sized byte array.
Await `writer.add(entry)` for each buffered or streamed compressed member, then
consume `writer.finish(comment?)` with backpressure. Transfers are capped at
16 KiB and by `chunkSize`; directory names use an external index when duplicate
rejection is enabled. Payload validation replays the staged bytes before output.
The caller must close storage on every outcome, including abandoned output.
A failed writer cannot publish or accept further members. Sources are borrowed
until `add` settles; yielded archive chunks are owned. The existing
`writeZipArchive` remains an explicit buffered convenience.

See [ZIP contracts](src/zip.ts) and [compression contracts](src/compression.ts)
for operation signatures and validation. ZIP decoding alone does not validate
Office relationships or document semantics.

## Development

Run `npm test --workspace=@poe-code/office-package` and
`npm run lint --workspace=@poe-code/office-package` from the repository root.
