# Bounded dynamic named host properties

Issue: #546.

- Add optional named metadata: synchronous keys/get callbacks, positive maxKeys/maxKeyCodeUnits bounds and an optional enumerable flag.
- Validate declarations passively and raw key arrays before normal host conversion. Require dense own-data arrays of unique strings; reject proxies, accessors, extra array properties and prototype capability names.
- Preserve fixed-member precedence and indexed ownership of length/canonical numeric names. Count masked names against provider bounds without exposing duplicate keys.
- Refresh names on reads, membership and enumeration checks so removal during earlier getters is visible. Do not cache host snapshots or use native proxies.
- Keep named values read-only, owner-checked and revocable. Preserve existing copy/replay restrictions and callback-free retained-data accounting.
- Charge key count, UTF-16 code units, enumeration and lookup against existing execution/array/string/data budgets.
- Verify hostile arrays, async rejection, identity/liveness, fixed/indexed composition, enumeration policies, mutation, copy boundaries and close. Publish with GitHub provenance and verify installed consumers before closing.
