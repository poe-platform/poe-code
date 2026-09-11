---
title: Uint8Array shared typed-array support
---

# Uint8Array shared typed-array support

The built SDK returned undefined for typeof Uint8Array. Eleven initial tests
failed before implementation (1.24s), spanning construction, methods, byte views,
shared prototype identities, subclassing, coercion, resizability and mixed-view
snapshot restoration.

Implement Uint8Array by generalizing the existing Float32 machinery, not by
copying its methods. Share intrinsic TypedArray constructors and prototypes;
select concrete native storage and byte width using a constructor registry.
Keep old Float32 snapshot records readable; encode new typed arrays with an
explicit validated type. Include host import/export, argument identities,
allocation limits, structured data copies, replay, lint and actual CLI execution.

The new tests also exposed structuredClone traversing callback metadata on
typed views and buffers, including guest accessors and subclass state. These
properties are not part of the platform structured-clone representation. Four
cases failed before that copying path was corrected; host data-copy restrictions
remain separate. Native differential checks now pass all 28 focused cases.

Reference: https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal

The companion harness uses the real runner with no model spawns or external
capabilities. It checks byte conversion, shared storage, cross-kind species and
intrinsic identities. Unit tests cover serialization and host boundaries.

Remaining family work is tracked in safejs-typed-array-family.md. This change does
not claim support for the other missing typed arrays or DataView. StructuredClone
transfer-list options and DOMException parity also need separate validation.

Verification so far:

- Initial missing-global regressions: 11 failures, 1.24s, before implementation.
- Expanded native/runtime/boundary selection: 28 passes, 1.54s.
- Full maintained SafeJS unit route: 18,534 passes, 41 skips, two failures in
  explicit legacy intrinsic inventories (311.20s). Both failures were solely the
  new Uint8Array binding; added that exact intrinsic to the expected graphs.
  The pre-existing uncommitted Promise-import policy probe was explicitly
  excluded, not treated as passing.
- Reran both affected legacy suites and the new Uint8Array persistence suite:
  78 passes, one maintained skip, four files, 2.36s. This includes resizable and
  detached mixed-view round trips, public run/dump/restore, completed-effect
  replay, backing-storage limits and one-byte-per-element allocation accounting.
- No matching open GitHub issue found for Uint8Array.
- TypeScript and ESLint pass on the changed source and test files.
- Maintained uncached build passes all 70 tasks (62.227s), followed by root
  bundle stages. The real harness passes and its screenshot was inspected.
- Built Node 18.18.0 SDK smoke passes Uint8Array conversion, shared Float32
  backing storage, toSorted and public dump/restore/re-execution.
