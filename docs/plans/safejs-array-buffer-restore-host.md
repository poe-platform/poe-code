# Resizable ArrayBuffer restoration on older hosts

## Confirmed gap

Node 18.18.0 silently ignores the ArrayBuffer constructor's maxByteLength option.
Calling the built snapshot decoder with four bytes and maxByteLength 16 returned
a fixed buffer with neither resizable nor maxByteLength metadata. The bytes
survived, but the represented JavaScript object's behavior changed.

Both primary and replay restoration use the same decoder. Regression tests
simulate the legacy constructor ignoring its second argument. Both routes failed
before the fix (2 failed, 18 passed; 1.08 seconds), recorded in
`/tmp/poe-safejs-buffer-restore-host-red.log`.

## Implementation

Verify the constructed buffer preserves the recorded maximum capacity before
copying bytes or returning it. Reject explicitly if the host cannot restore that
state, including zero capacity and capacity equal to the current byte length.
Fixed buffers retain their existing path. This prevents silent snapshot
corruption; it does not implement resizable buffers on hosts that lack them.
That compatibility gap remains open in the wider JavaScript-completeness work.

## Verification

Run primary/replay snapshot tests and Float32Array/ArrayBuffer regressions,
TypeScript and scoped ESLint. Verify the built decoder on real Node 18, including
a fixed-buffer positive control, and on a resizable-buffer-capable Node version.
Use the existing Float32 at harness pair for a CLI smoke check and inspect its
screenshot; this smoke check does not replace the decoder regression tests.

Completed: 392 buffer/Float32 tests passed (15.98 seconds), then all 1,177
snapshot tests passed (21.35 seconds), including added positive capacity controls.
TypeScript and scoped ESLint passed. The harness passed after 70 uncached build
tasks (58.145 seconds), and its screenshot was inspected. The built decoder on
Node 18.18.0 explicitly rejects unsupported resizable storage while preserving
fixed-buffer bytes; Node 22.23.2 preserves capacity, bytes and subsequent resize.
No matching open GitHub issue was found.
