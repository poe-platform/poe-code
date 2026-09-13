# pptx package usage draft

Status: local private workspace with bounded document operations and a live model.
This draft substitutes for package README changes until permission is given;
it is not a published installation or whole-public-API coverage claim.

The workspace is named exactly `pptx`. It is TypeScript ESM with strict NodeNext
compilation and declaration exports. Its declared runtime dependencies are the
shared Office package, XML parser and hash library. The main export includes
`Presentation`, `createPptxCommandEngine`, document operations, types and neutral
errors. `pptx/bytes` exports `readBinary` and `writeBinary`; these transport
primitives alone do not validate ZIP or PPTX.

The command engine supports `schema` and `capabilities` discovery. The safe-bash
adapter supplies explicit virtual filesystem and publication capabilities for
`pptx` commands. Discover the actual supported subset before editing:

```sh
pptx schema text replace --json
pptx capabilities --json
pptx text replace deck.pptx --find Draft --with Final --first --output final.pptx --json
pptx properties set deck.pptx --name title --value 'Coastal survey' --output titled.pptx
```

Use plural resources such as `images`, `tables` and `properties`. Model members
retain neutral spellings such as `core_properties` and `slide_layouts`; operation
JSON options use camelCase. `Presentation(input?, context?)`, save and input
admission are asynchronous. Owned in-memory property access is synchronous.
CLI positions are one-based; model sequences are zero-based and keyed placeholders
retain key lookup. Fingerprinted selectors must be current and owner-scoped.

The command engine uses the shared version-1 JSON result and exit profile:
success 0, content/selection/unsupported 1, usage 2, I/O 3, limits 4, cancellation 130. Diff uses 0 equal, 1 different, 2 failed comparison and 130 cancelled.
Outputs require explicit publication intent; dry-run validates without publishing.
No host filesystem, native presentation runtime, network, clock or identity is
implicitly available. [Model usage and evidence](presentation-public-surface-evidence.md),
[text replacement](text-replacement.md) and [merge/split](slide-merge-split-usage.md)
describe bounded interfaces. Inherited members, enums, collections, helpers and
untested public APIs remain subject to the shared SDK's full coverage requirements.

The remaining sections document the byte transport interface specifically. Their
limits and publication boundaries must not be read as package-wide limitations.

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

`BinaryInput` accepts bytes, a pull source, or `{path, capability}`. A source's
`read(maxBytes, signal?)` resolves to at most the requested bytes; only `null`
means EOF. Empty chunks consume read budget. At the exact byte ceiling, one
single-byte EOF probe detects overflow and also consumes a read. Sources are
borrowed; the caller owns their lifetime and cleanup. `VfsCapability.openRead`
receives the explicit path and signal and returns a source. The trusted host must
enforce its configured root and authorization, including symlinks. The package
never constructs a filesystem, interprets a bare string as a path or fetches links.
The optional signal parameter extends the documented one-argument pull protocol
without changing its Promise or EOF behavior.

| Configuration                                                | Meaning                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `context.limits.maxBytes`                                    | Required positive safe integer ceiling for one byte transfer                               |
| `context.limits.maxReads`                                    | Required positive safe integer ceiling for source calls, including empty chunks and EOF    |
| `context.limits.chunkBytes`                                  | Required positive safe integer maximum read request or sink write size                     |
| `context.signal`                                             | Optional explicit cooperative cancellation signal passed to source, opener and sink writes |
| `options.maxBytes`, `options.maxReads`, `options.chunkBytes` | Optional lower ceilings; an increase fails before I/O                                      |
| `writeBinary` option `close`                                 | Boolean, default false; await sink close after successful writes only                      |

No environment variables or ambient configuration are read. `undefined` selects
a default; `null`, fractions, nonfinite numbers, zero, negative limits and unknown
options fail. `maxReads` controls source calls only and is rejected as an output option; output uses `maxBytes` and
`chunkBytes`. Limits here are per transfer, not cumulative graph/merge budgets or
a substitute for future archive/XML admission limits.

Both functions always return Promises, including invalid-input errors. Byte input
is copied before the first yield; each source chunk is copied before the next
read. The returned array belongs to the caller. Input collection can retain up to
twice `maxBytes` while assembling its result, plus the currently borrowed chunk.
Output snapshots the complete input before writing and gives sinks separate chunks.
Writes are sequential and awaited. A caller must not mutate a producer's chunk
concurrently before its read Promise is consumed. Host callbacks are trusted code,
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

Maintained development routes:

```sh
npm run build:workspaces -- --workspace=pptx
npm test --workspace=pptx
npm run lint --workspace=pptx
```

The wildcard workspace discovery includes these build/unit routes automatically.
Tests use original bytes and memfs; existing fixture/assertion suites remain in
the package test selection. Distribution includes only emitted runtime/declaration
files, package metadata and the standalone license. Research and test fixtures
are excluded. Browser/workerd export-condition resolution is checked separately
from execution in those hosts; native host qualification is not implied.
