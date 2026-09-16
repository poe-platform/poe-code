# @poe-code/office-package

Private ESM workspace providing shared ZIP and compression codecs for Office
packages. It has no standalone CLI or public installation promise.

```js
import { createCompressionCodec, createZipCodec } from "@poe-code/office-package";

const compression = createCompressionCodec();
const zip = createZipCodec();
```

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
`utcDates`, and `validatePayloads`. ZIP operations require `ZipLimits`:
`maxArchiveBytes`, `maxEntryBytes`, `maxTotalBytes`, `maxMembers`, `maxPathBytes`,
`maxDepth`, `maxPaxBytes`, `maxTextBytes`, and `chunkSize`.
See [ZIP contracts](src/zip.ts) and [compression contracts](src/compression.ts)
for operation signatures and validation. ZIP decoding alone does not validate
Office relationships or document semantics.

## Development

Run `npm test --workspace=@poe-code/office-package` and
`npm run lint --workspace=@poe-code/office-package` from the repository root.
