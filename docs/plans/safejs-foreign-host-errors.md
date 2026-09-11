# Foreign-realm host errors

## Evidence

Seven VM-created native error types were rejected by public input admission. Synchronous and asynchronous host callbacks throwing a foreign TypeError produced a guest Error instead. Nine regression tests failed before the correction.

## Implementation

Use Node's native-error brand check in addition to the existing local Error compatibility check. Reuse the same classification throughout host-error construction so native type, message, aliases, and allowlisted metadata survive conversion. Keep the local fallback for supported host errors such as Node 18 DOMException.

Do not treat error-shaped records as native errors or expand the metadata allowlist. Accessor metadata remains unread. Preserve genuine engine-error identity and existing error-data safety boundaries.

## Validation

- Foreign native Error, TypeError, RangeError, ReferenceError, SyntaxError, URIError, and EvalError bindings.
- Synchronous and asynchronous host throws.
- Repeated aliases, metadata filtering, and error-shaped record controls.
- Host bridge, engine-error identity, diagnostic accessor, replay, and snapshot error coverage.
- Changed-file lint and maintained SafeJS build with built-import smoke tests.
- Native Node 18 built-runtime foreign-error probe.

## Remaining work

Foreign AggregateError member import still uses a realm-local AggregateError check and needs independent validation and correction. The `Error.isError` static method remains separate work.
