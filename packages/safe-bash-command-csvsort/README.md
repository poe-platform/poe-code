# csvsort

Sort already-admitted records in memory with explicit resource limits. This
private TypeScript ESM workspace is not published. A CSV command and the proposed
`@poe-platform/safe-bash/commands/csvsort` import are **not available** yet.

The current API exports `sortRecords`, `CsvSortError`, `SortKey`, `SortRecord`
and `SortLimits`. From this workspace's built module:

```ts
import { sortRecords } from './dist/index.js';

const encode = new TextEncoder();
const rows = [
  { bytes: encode.encode('ten\n'), keys: [{ integer: '10' }] },
  { bytes: encode.encode('two\n'), keys: [{ integer: '2' }] },
];
const sorted = sortRecords(rows, { reverse: false }, {
  retainedBytes: 4096, work: 4096, records: 100, keyBytes: 256,
}, new AbortController().signal);
// sorted payloads: "two\n", "ten\n"
```

Keys are text, canonical signed decimal integers, or `null`; each column must
have one nonnull key type and every record must have equal key arity. Integers
have no leading zeroes, plus sign, fraction, exponent or negative zero. Text uses
Unicode code-point ordering. Composite sorting preserves ties, including with
`reverse: true`; nulls sort last ascending and first descending.

All four limits are required nonnegative safe integers, with no defaults:

| Limit | Accounting |
| --- | --- |
| `records` | Maximum input record count. |
| `keyBytes` | Maximum bytes per nonnull key, measured as twice its UTF-16 length. |
| `retainedBytes` | Payload bytes, UTF-16 key bytes, 8-byte key/type slots and two 8-byte index slots per record. Logical storage, not engine heap/RSS. |
| `work` | Admission/copy/key validation and comparator/merge work units. |

The return value is an ordered readonly record array with owned copies of input
payload bytes and integer keys. Payloads remain opaque: no CSV decoding,
header handling, newline normalization or serialization occurs. Failures throw
`CsvSortError` with `OPTION`, `KEY` or `QUOTA`; an aborted signal throws its exact
reason. Failed invocations release their local retained-record array and have no
persistent sorter state.

**Commands and flags:** none. The SDK's only sorting option is `reverse`; it is
not a native CLI flag. There is no command adapter, byte-stream/VFS I/O, invocation
cleanup registration or CLI/SDK command parity yet. No external runtime
dependencies, host executables, network, ambient files, native/WASM fallback or
runtime downloads are used by this pure synchronous sorter. Cancellation is
checked cooperatively within that call, without yielding to the event loop.

This is not csvkit compatibility: Decimal precision/context, Boolean and temporal
inference, dialects, selectors and CSV grammar/error profiles remain unimplemented.
Exact integer sorting here does not emulate native precision-28 number casting.
Node workspace checks qualify this stage; browser/workerd engines and installed
safe-bash subpath declarations remain unqualified.
