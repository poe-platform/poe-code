# Iterator prototype setter receiver operations

## Reproduction

Ten native-comparison cases failed before runtime modification (402ddf).
Both `Iterator.prototype.constructor` and `Symbol.toStringTag` setters wrote
to a Proxy's implementation carrier without invoking its descriptor or write
traps. Target properties stayed unchanged; refused definitions and descriptor
errors disappeared. The tag setter also unconditionally redefined existing
ordinary properties rather than using assignment semantics.

The specified operation is
[SetterThatIgnoresPrototypeProperties](https://tc39.es/ecma262/#sec-setterthatignoresprototypeproperties):
check the receiver's own descriptor, define a new data property when absent,
otherwise perform a throwing Set. The special prototype/primitive receiver
rejection remains in place.

## Fix

Use `sandboxGetOwnPropertyDescriptor`, `defineDataProperty` and
`setSandboxProperty` in both setters. These reuse existing guest operations
for ordinary objects, specialized carriers and Proxies. Keep the existing
post-write data checkpoint. No host-property copying or new Proxy path is added.

## Verification

- Initial ten regressions plus generator intrinsic/prototype checks: 70 tests
  passed in two files (03062c).
- Expanded regression covers non-configurable writable data properties,
  accessors, read-only properties and pending/completed JSON checkpoint replay.
- TypeScript no-emit passed (9f1d90).
- README updated; no visual CLI change.

Broader Iterator selection passed all 221 tests in 16 files (3995f8), including
the expanded 18-case regression file. Runtime/test lint passed (a52ce4), and
the final expanded test file passed lint separately (022194). Whitespace
validation passed (709fb9).
No push, release or full-suite success is implied by this focused repair.
