# Portable compression

Incremental raw DEFLATE, zlib and gzip codecs for byte streams, using the shared pako backend. This private workspace is bundled by public consumers.

```ts
import { createCompressionCodec } from "@poe-code/compression";

const { codec, CodecReader } = createCompressionCodec();
const reader = new CodecReader(source, signal);
try {
  for await (const bytes of codec(reader, { mode: "inflate-zlib" }, signal)) {
    await destination.write(bytes);
  }
} finally {
  await reader.close();
}
```

Modes: `gzip`, `gunzip`, `deflate-raw`, `inflate-raw`, `deflate-zlib`, `inflate-zlib`. Output chunks are owned and at most 64 KiB; consumers control backpressure. Pass runtime hooks for scheduling, input validation and diagnostics. Limits belong to callers. Raw and zlib decoders restore trailing input to the reader; gzip retains member admission and padding policy. Set `singleMember: true` with `gunzip` to require EOF immediately after one member, rejecting padding, trailing bytes and additional members. Readers own input retirement and must be closed in `finally`.

The codec accepts bytes only, with no filesystem or container dependency. File adapters use the caller's injected filesystem. Other compression engines remain with their current owners until a concrete shared consumer requires migration.

For existing in-memory APIs, `createByteCodec({ direction: "decode", format: "zlib" })` exposes a synchronous `push(bytes, final)` iterator. Drain each iterator before pushing again and call `close()` in `finally`; stopping an iterator early closes its codec. Formats are `raw`, `zlib`, and `gzip`. The explicit decode-only `zlib-or-gzip` selection preserves legacy readers that accept either wrapper, including a zlib member following gzip. Gzip supports concatenated members and terminal zero padding. `consumed` reports bytes consumed from the last push. `ByteCodecError.code` distinguishes invalid data from truncation so format owners can preserve recovery policies.

`transformBytes(bytes, options)` collects the result for explicit in-memory convenience operations. It is not a streaming file API and does not establish bounded memory for an image, PDF or document workflow. Those workflows must supply incremental input/output and keep any seek-dependent state in caller-authorized storage.
