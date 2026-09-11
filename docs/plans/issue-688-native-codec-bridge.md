# Bounded portable native codec bridge

The compression commands use committed JavaScript generated from bzip2 1.0.8,
liblzma 5.8.3 and Zstandard 1.5.7. `sources.json` records the exact upstream
snapshot, complete vendored source-tree digests, build tool versions and emitted
artifact sizes and SHA-256 digests. `LICENSES.txt` includes codec and linked WASI
libc notices. Normal builds copy authenticated artifacts; they neither download
nor compile native code.

The maintenance command is:

```
node packages/safe-bash/src/commands/bytes/compression/native/build.mjs PINNED_SOURCE_CHECKOUT ZIG_0_14_1 WASM2JS_132
```

The checkout must match the recorded compress-utils commit and each complete
codec source tree. Use the repository's recorded esbuild and TypeScript versions.
The generator compiles a reactor with Zig, translates with Binaryen, uses the
TypeScript AST to isolate each instance and repair Binaryen's missing failure
return from memory growth, and minifies with esbuild. The factory requires no
eval, Function constructor, runtime WASM compilation, fetch, or Node imports.

Each bridge call accepts at most 64 KiB of input and output and returns native
consumed/produced counts. A frame end preserves the remainder for the driver's
concatenated-frame handling. XZ stream padding is handled by the driver. Native
allocations, including aligned bookkeeping headers, share a 64 MiB live limit;
linear memory has a 128 MiB maximum. These are logical storage bounds, not a
process RSS limit. Destruction releases codec allocations; separate factories
own separate mutable memories. XZ defaults to preset 3; accepted higher presets
may fail explicitly when their native allocations exceed the limit.

Initial 2 MiB pure-JS bzip2 level-9 probes exposed synchronous block-sort calls
lasting about 3 seconds despite the I/O window. The bridge now flushes encoding
blocks at 64 KiB while preserving the requested level and valid format header.
The same periodic/random probes observed maximum calls around 190/233 ms.
Native 900 KiB decoder blocks observed maxima around 57/42 ms. These are finite
local measurements, not universal time guarantees. The decoder still accepts
native maximum-size blocks. Cancellation is observed between bounded codec calls.

Evidence is in `/private/tmp/poe-688-bridge`: `measure-before-flush.log`,
`measure-flush.log`, `decode-measure.log`, raw WASM and JavaScript round-trip
fixtures, and `native-tests-red.log`/`native-tests-green.log`. The maintained
memory-only native bridge test covers partial input/output, exact concatenated
remainder, allocation failure cleanup, I/O admission and recovery. Actual workerd
without Node compatibility executed the JavaScript factories successfully; the
integration owner separately verifies public installed artifacts and streaming
cancellation/adversarial limits.
