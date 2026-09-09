# Proxy property writes

The first test run (96018) exposed a syntax error in nine generated native
invariant cases; those were test errors, not evidence of runtime defects. After
correcting the generator, all native comparisons executed and the selection
produced 15 runtime failures and two passing controls on 766a2564b (89570).

Extract the maintained Reflect setter algorithm into the shared Set operation.
Add Proxy dispatch along target prototype chains, preserving the original
receiver. Missing traps recurse; false trap results skip invariant queries;
truthy results check frozen-data SameValue and protected setterless properties.
Ordinary receiver writes use Proxy-aware own-descriptor queries and the maintained
definition path. Preserve namespace refusal, typed-array handling and inherited
setter behavior. Retain target, assigned value, receiver and captured descriptors
across guest work, releasing them on every exit.

The initial selection passed 98 tests across three files (26710), followed by
successful TypeScript and scoped lint. Expanded retention, revocation and traversal
budget controls plus ordinary accessor and numeric/BigInt typed-array tests
passed: 240 tests across four files, followed by final test-file lint (31110).

Reflect is integrated here. Guest assignment/update/destructuring paths and
array-method callbacks still require Proxy Set integration. Enumeration, callable
identity, public construction and snapshots remain incomplete. No full-package
gate, push or release is claimed.
