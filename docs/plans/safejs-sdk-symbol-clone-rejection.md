# SDK structured-clone symbol rejection

## Validated gap

The SDK structured-clone option reached the ordinary primitive-copy path and
returned symbol values unchanged. Six tests failed before repair (a7c267):
direct symbols and symbols in records, arrays, Map keys, Map values and Sets.
Each has a native structuredClone rejection oracle. The passing ordinary-copy
control shows that ordinary symbol identity must remain unchanged.

Reject symbol values with DataCloneError before ordinary primitive copying when
structured cloning is requested. The passing matrix checks local, registered
and well-known symbols in all six graph positions. This changes neither symbol
property-key selection nor ordinary SDK copying.

## Verification

- Node 22: 56 tests passed across the new SDK matrix, existing interpreter
  symbol-value/property-key/boxed-symbol cases, Promise cloning and value copies.
- Package TypeScript no-emit checking passed.
- Node 18.18.2: all seven new tests passed.
- Focused lint passed for values.ts and the new regression file.

This bounded repair does not establish full SDK/interpreter structured-clone
parity; other admission and traversal differences require their own tests.
Only the two-line symbol guard, its regression file and this plan are staged;
unrelated Temporal/weak integration in values.ts and staged Safe Bash changes
remain untouched. Local commit only under the release hold. No CLI appearance
changes, push, publication or issue closure.
