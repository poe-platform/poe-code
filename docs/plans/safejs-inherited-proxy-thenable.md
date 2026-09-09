# Inherited Proxy thenable resolution

Six native comparisons failed before the repair: Promise resolution skipped
Proxy ancestors when looking up then, losing inherited thenables, receiver
identity, trap effects, thrown errors, and revocation failures. Callback returns
had the same defect.

Use the descriptor walk's existing Proxy-boundary callback in both the resolution
predicate and thenable lookup. Resume the asynchronous guest read at that boundary
with the original receiver. Ordinary own descriptors still terminate the walk;
do not query a Proxy ancestor when an own then shadows it.

Nine native comparisons now cover the reproduced failures plus own-property
shadowing (including a revoked ancestor) and multiple ordinary prototype levels
on async return. A checkpoint test retains an inherited Proxy thenable across
await and verifies restored execution against native JavaScript.

Verification:

- Inherited resolution and Proxy checkpoint selection: 42 tests passed, 2 files.
- Broader Promise selection: 661 tests passed, 46 files.
- Scoped ESLint and package TypeScript (`tsc --noEmit`) passed.
- The host-Promise property-import policy tests are excluded from this focused
  selection and remain unresolved. This is not a full-package gate.

The package README documents the added behavior. No CLI presentation changes.
Keep this improvement in its own local commit while pushes and releases are held.
