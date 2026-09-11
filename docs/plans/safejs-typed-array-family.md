# Complete the typed-array family

## Validated gap

On 2026-09-07, the built SDK was probed with `run("return typeof " + name)`
for every typed-array constructor and DataView. Float32Array returned function;
Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array,
Uint32Array, Float16Array, Float64Array, BigInt64Array, BigUint64Array and DataView
all returned undefined. These are missing runtime capabilities, not merely lint
allowlist omissions. The globals factory and known-globals rule only register
Float32Array among this family.

## Implementation direction

Generalize the existing typed-array machinery instead of copying the complete
Float32Array implementation into each constructor. A declarative constructor
description should supply name, element width, native storage constructor and
numeric content type. Preserve one shared intrinsic TypedArray prototype per
realm, with concrete per-kind prototypes and constructor identities.

The first implementation must include Uint8Array end to end, proving that the
shared design handles an element width other than four and integer conversion.
Do not treat exposing a global as completion: cover construction, indexed reads
and writes, coercion, descriptors, species, methods, iterators, subclassing,
buffer aliases, resizable and detached storage, host boundaries, resource
accounting, snapshots, replay, lint and the actual runner.

Then apply the same machinery to all numeric kinds. BigInt kinds require
ToBigInt and content-type incompatibility checks rather than ToNumber; Float16
needs a deliberate older-host strategy. DataView needs its own endianness-aware
operations, but must share backing-buffer identity and budget accounting.

## Existing integration points to inspect

- `interp/typed-array.ts`, `interp/globals/numeric-typed-array.ts`, prototype registry.
- Globals, intrinsic identity registration and lint known-globals.
- Values and data-copy paths, host bridge and host-call argument digests.
- Interpreter property assignment, object model, object/array descriptor APIs.
- Iteration, array iterators, instanceof and string coercion.
- Snapshot storage/layout, primary serialization/restoration, diagnostic dumps,
  replay graphs and snapshot validation.

Preserve the existing Float32 snapshot format when reading old snapshots; new
typed-array records must identify their concrete kind and validate width,
alignment, dimensions and content before allocation. Preserve aliased backing
buffers across mixed view kinds and repeated restoration.

## Evidence required

Write failing tests against current code before production edits. Differential
checks must use the published specification when native Node versions disagree.
Run the maintained SafeJS package checks for the broad integration, including
resource, adversarial, checkpoint and replay coverage. Validate supported older
hosts with the built SDK. Do not silently skip unsupported kinds or downgrade
their precision/content type. Each cohesive, verified improvement receives its
own commit and push; monitor releases while continuing implementation.

Status: Uint8Array now uses the shared numeric typed-array implementation,
including mixed-view snapshots, host boundaries and byte-width accounting.
The initial absence remains the baseline evidence; the remaining absent kinds
must be tested and added in subsequent atomic improvements.

Uint8Array-specific hexadecimal/base64 methods also require a separate pass;
the shared typed-array methods do not implement these concrete-type extensions.

Number-valued family follow-up: Int8Array, Uint8ClampedArray, Int16Array,
Uint16Array, Int32Array, Uint32Array and Float64Array are now registered through
the same machinery. Validation and remaining gaps are recorded in
`safejs-number-typed-arrays.md`. This does not add Float16, BigInt kinds or DataView.
