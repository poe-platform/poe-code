# Error.isError

## Validated gap

The built runtime returned `undefined` for `typeof Error.isError`. Initial method and descriptor tests failed. Current ECMAScript defines Error.isError as an object error-brand check, not an instanceof or diagnostic-property check:
https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-error.iserror

## Implementation

Expose the static method on the modern Error intrinsic using the existing sandbox error-brand registry and native host error-brand check. Register its intrinsic identity and mutation tracking so escaped aliases survive JSON snapshots. NativeError constructors inherit the method through their existing constructor prototype linkage.

Preserve Node 18 compatibility. Do not use a host Error.isError method, which is unavailable on older supported runtimes. Do not infer brands from names, messages, prototypes, or Symbol.toStringTag. The legacy `errorPrototypes: false` compatibility mode is unchanged.

## Validation

- All supported native error constructors, subclass instances, interpreter-generated failures, and prototype replacement.
- Error prototypes, ordinary objects, primitives, missing arguments, and diagnostic getters.
- Host-input Error, foreign TypeError, and DOMException.
- Raw host proxies and revoked proxies without invoking traps.
- Static descriptors, name, length, inherited aliases, and JSON-restored escaped aliases after overriding Error.isError.
- Existing error prototype, exception, replay, snapshot error, and host-boundary suites.
- Changed-file lint, maintained SafeJS workspace build, import smoke checks, and Node 18 built-runtime probes.

## Related delivered prerequisites

Private wrapped host causes are excluded from guest/replay data. Foreign native errors are admitted and retain their diagnostic type. Both corrections were committed and pushed separately before this feature.

## Results

The package run passed 19,715 tests with 41 skips, retaining only the two already documented exclusions for host-Promise property import and weak collections. The additional non-constructor regression passed in the final 26-test method suite. Changed-file lint, the 23-workspace build closure, four built-import checks, and Node 18 built Error/foreign TypeError/DOMException brand probes passed. The maintained CLI help screenshot was inspected for layout only; it is not evidence of method semantics or agent spawning.
