# Retained guest arguments

Issue: #542. Build on the published persistent realm and host bridge.

- An extension declaring and receiving `guest:retain` can call `context.retainGuestArguments(operation, from)` during setup. The declaration belongs to that realm and operation; live methods use it unchanged.
- Arguments before `from` use existing copy/callback conversion. Each later argument becomes a frozen opaque `GuestReference`, including primitives, cycles, closures and live host objects.
- Returning a reference or passing one as a callback receiver/argument restores the original value only in the owning realm. Ordinary unmarked operations keep copy semantics.
- `releaseGuestReference` on the context or realm revokes one reference. Close revokes all references. Synchronous native failure rolls back references captured for that invocation.
- Bound reference counts with `limits.guestReferences` and collection budgets. Retain complete guest graphs and compile ownership in cumulative data accounting until release, including detached data and closures.
- Reject foreign, stale, replay and error-data conversions without exposing interpreter fields. Capability grants authorize trusted native code; they do not sandbox that code.

## Verification

- Deferred timer identity and post-scheduling mutations; cyclic values, primitives, guest closures and live capabilities.
- Leading argument copying, live methods, explicit grants, declaration validation and default-copy regression.
- Native throw rollback, individual release, close, foreign ownership, replay/error rejection and data/collection limits.
- Full SafeJS suite, package/root types and lint, followed by installed public Node/Bun/TypeScript consumers.
- GitHub publication, registry/provenance verification and issue closure before the next issue.
