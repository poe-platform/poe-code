# SafeJS persistent realms and trusted extensions

Issue: #540. Retained guest argument handles (#542) build on this boundary but are not part of this change.

## Public boundary

- `createRealm` accepts the existing bindings/module registry, a cumulative budget, cancellation, explicit extension registrations and capability grants.
- `defineExtension` freezes a version-1 manifest and synchronous setup function. Manifests declare names, capabilities, globals and module exports.
- Validate all manifests, grants and name conflicts before calling any setup function. No discovery, guest plugins or browser implementation.
- Setup is lazy, once per realm. Closing an unused realm does not run setup.
- Realm evaluations retain the same interpreter scope and intrinsic objects. They never replay previous source.
- Extension contexts expose cancellation, bounded cleanup registration, work charging, live host objects, guest callbacks and explicitly authorized nested source evaluation. They do not expose scopes, interpreter objects or budget mutators.

## Identity and execution

- Reuse the interpreter's existing Scope, compile ownership, job scheduling and host conversion paths.
- Ordinary host data keeps copy semantics. Live host objects are explicit realm-owned opaque capabilities with declared synchronous properties and methods.
- Host handles and guest callback wrappers have stable identity, bounded retention and explicit revocation. Closing or failing a realm revokes them before awaiting cleanup.
- Public callback invocation preserves its receiver and uses the owning realm's cumulative budget. Unrelated concurrent evaluations and unauthorized reentry fail.
- An extension declaring and receiving `source:nested` may mark a host operation with `nestedOperation`. Only that operation's live invocation can use `evaluateNested`.
- Nested evaluation completes before the enclosing host call returns to guest code, shares declarations and limits, and has bounded nesting. It is not a general reentry bypass.

## Failure and persistence

- Fatal budgets and cancellation poison the realm even when trusted host code catches the immediate error.
- Cleanup runs in reverse registration order, awaits every disposer, and preserves failures. Close is idempotent.
- Extension factories are synchronous. Returned promises are rejected as unsupported rather than racing startup and disposal.
- Live realm capabilities are not portable checkpoint, replay or error data. Reject unsupported conversion paths explicitly.
- One-shot `run` can use the same extension registrations and closes them before returning. Its live extension state is not a resumable snapshot.
- Native host work remains trusted and cooperative. External process supervision is required for hard native-code deadlines.

## Verification

- Persistent bindings, closures, intrinsics, module imports and independent realms.
- Passive manifest validation, denied grants, duplicate names and zero setup side effects.
- Partial setup failure, reverse asynchronous cleanup, repeated close and observable cleanup errors.
- Live property/method identity, foreign/stale handles and no ambient host prototypes.
- Callback receiver/state retention, release, collection/data budgets, cancellation and swallowed fatal errors.
- Nested parser-like source ordering, scope identity, bounded recursion and unauthorized reentry rejection.
- Full SafeJS regressions and compiled public Node/Bun consumer with a small DOM-like adapter using no internal imports.
