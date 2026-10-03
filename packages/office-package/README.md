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

`decodeZipEntry` also accepts a `ZipStreamEntry`: supply `data` as an async byte
stream (or a `(signal) => stream` factory) and `compressedSize` alongside the usual
member metadata. Range-backed entries use factories so each decode cancellation
reaches pending reads. The stream may
read a retained range from the caller's injected filesystem; the codec itself
opens no files. Decoding checks the compressed length, decoded length and CRC,
returns owned bounded chunks, and closes the input on cancellation or early return.

See [ZIP contracts](src/zip.ts) and [compression contracts](src/compression.ts)
for operation signatures and validation. ZIP decoding alone does not validate
Office relationships or document semantics.

## Development

Run `npm test --workspace=@poe-code/office-package` and
`npm run lint --workspace=@poe-code/office-package` from the repository root.
