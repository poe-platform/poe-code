# SuppressedError

## Validated gap and requirements

The built runtime returned `undefined` for `typeof SuppressedError`. Five initial regression tests failed. Implement the constructor defined at https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-suppressederror-objects: callable or constructible, subclassable, error-branded, with non-enumerable writable configurable `error` and `suppressed` payload properties. Coerce only the optional third message argument and ignore extra options.

## Integration

- Register the error name, global lint name, intrinsic constructor/prototype, and snapshot error brand.
- Preserve payload aliases in guest snapshots and host data copies.
- Use the native host SuppressedError prototype when available. Provide a private compatibility constructor on older supported Node versions, without installing any global.
- Copy own `error` and `suppressed` data properties through the existing host error-data copier, alongside `errors`. This treats those standard payload names uniformly on native errors; no subtype guessing or additional arbitrary properties. Ignore accessors and inherited fields, and reject functions and promises.

## Evidence found during integration

The first host-export test failed because the native error-prototype copy map lacked SuppressedError. After adding host compatibility, the first host-import test returned undefined payloads. Both failures were reproduced before their corrections.

The first wider run passed 19,740 tests but failed two explicit legacy-checkpoint intrinsic enumerations. Add only the exact new constructor to those expectations, preserving graph, alias, metadata, and fixture-immutability checks. A separate built probe and regression test demonstrated legacy-mode payload loss during host copying; legacy error transport uses enumerable payloads like its existing AggregateError implementation, while modern instances retain standard non-enumerable descriptors.

## Verification

Check constructor calls, subclassing, descriptors, undefined arguments, message coercion, ignored options, Error.isError, JSON snapshot aliases, native host compatibility, cyclic imports, and rejection of executable/accessor payloads. Run relevant error, bridge, copy, lint, and snapshot coverage followed by the wider SafeJS package route, selective lint, and maintained build/import checks. Keep Node 18 support. This does not claim to implement using declarations or disposable stacks.

## Delivery validation

After the independently delivered dense-array optimization, the combined package run passed 19,747 tests with 41 skips and only the two previously documented exclusions (host-Promise property import and weak collections). Changed-file lint, the maintained 23-workspace build, and all four built-import checks passed. Node 18 probes passed modern construction, legacy copying, and host export/import. A standalone CLI probe printed both payload messages and intentionally threw the new error; its screenshot was inspected and its exit code was 1 as expected. This probe did not exercise real agent spawns.
