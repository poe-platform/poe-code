# PPTX byte transport

The private `pptx/bytes` entry point exports `readBinary` and `writeBinary`.
These transport primitives do not validate ZIP or PPTX. See [usage](usage.md)
for presentation operations, model examples and host configuration.

```typescript
import type { ByteContext, ByteSink } from "pptx";
import { readBinary, writeBinary } from "pptx/bytes";

const context: ByteContext = {
  limits: { maxBytes: 1024, maxReads: 64, chunkBytes: 256 }
};
const bytes = await readBinary(Uint8Array.of(10, 20, 30), context);
const received: Uint8Array[] = [];
const sink: ByteSink = {
  async write(chunk) {
    received.push(chunk);
  },
  async close() {}
};
await writeBinary(bytes, sink, context);
```

`BinaryInput` accepts bytes, an `AsyncIterable<Uint8Array>` from the shared
`@poe-code/safe-fs` stream contract, or `{ path, fs }` with an explicitly supplied
safe-fs filesystem. Empty chunks and the final EOF observation consume read
budget. At the exact byte ceiling, the next iterator result detects overflow.
Iteration is completed on success and closed with `return()` on failure or
cancellation. Filesystem reads receive the byte ceiling and cancellation signal;
streaming is preferred, with bounded `readFile` fallback when unavailable before
any payload is emitted. The trusted host enforces its root and authorization,
including symlinks. Bare strings never authorize filesystem access.

```typescript
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
const fs = createMemoryFileSystem();
await fs.writeFile("/input.bin", Uint8Array.of(10, 20, 30));
const input = await readBinary({ path: "/input.bin", fs }, context);
```

This replaces the former `{ path, capability: { openRead } }` and pull-reader
interfaces. Supply a safe-fs filesystem or an async generator instead.
`ByteSink` extends the shared safe-bash sink contract with optional cooperative
cancellation and explicit close.

| Configuration                                                | Meaning                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `context.limits.maxBytes`                                    | Optional ceiling for one byte transfer; unlimited when omitted                             |
| `context.limits.maxReads`                                    | Optional ceiling for source calls, including empty chunks and EOF; unlimited when omitted  |
| `context.limits.chunkBytes`                                  | Positive safe integer maximum sink write size; defaults to 65536             |
| `context.signal`                                             | Optional explicit cooperative cancellation signal passed to filesystem and sink writes |
| `options.maxBytes`, `options.maxReads`, `options.chunkBytes` | Optional overrides; can raise or lower earlier settings                                    |
| `writeBinary` option `close`                                 | Boolean, default false; await sink close after successful writes only                      |

No environment variables or ambient configuration are read. `undefined` selects
a default; `null`, fractions, NaN, zero, negative limits and unknown
options fail. `maxReads` controls source calls only and is rejected as an output option; output uses `maxBytes` and
`chunkBytes`. Limits here are per transfer, not cumulative graph/merge budgets or
a substitute for archive/XML admission limits. SDK resource ceilings also accept
`Infinity` for unlimited; chunk sizes must remain finite.

Both functions always return Promises, including invalid-input errors. Byte input
is copied before the first yield; each source chunk is copied before the next
read. The returned array belongs to the caller. Input collection can retain up to
twice `maxBytes` while assembling its result, plus the currently borrowed chunk.
Output snapshots the complete input before writing and gives sinks separate chunks.
Writes are sequential and awaited. A caller must not mutate a producer's chunk
concurrently before its iterator result is consumed. Host callbacks are trusted code,
not a JavaScript sandbox.

Cancellation is checked at admission and between awaited callbacks. Callbacks
must cooperate with the supplied signal; the SDK does not forcibly terminate
uncooperative callbacks. Host exception text is replaced by bounded neutral
messages. `OfficeError` exposes `code`, `phase`, `name` and `message`; this layer
uses `invalid-type`, `invalid-value`, `resource-limit`, `cancelled`, `io-failure`.

`writeBinary` performs raw transport only. It requires a byte sink, never publishes
a VFS path, and makes no validation or atomicity promise. Failure may follow partial
writes; it does not close a failed or borrowed sink. Explicit close is awaited;
a close failure reports I/O failure. A successful close is the completion boundary.
The declared `BinaryOutput` union reserves capability-scoped paths for future
validated publication; it is not the accepted destination type of `writeBinary`.

`OperationRequest<Id, Arguments, Options>` is a type-only building block; use the
explicit command engine for registered operations, not dynamic method evaluation.
`OfficeResult` defines
the common eight fields and discriminates successful data from prepublication
failures with null data, zero affected count and nonempty errors. Byte transport
does not provide multi-output publication. Fingerprinted `Location` uses an identity
coordinate system and the format's eight scopes. No unimplemented model methods,
inherited members, collections or enums have been renamed or marked private.
