# Proxy own-property descriptor reads

## Validation and implementation

On 0bf89e773, the Object/Reflect native-comparison matrix produced 30 failures
and four passing controls (24217). Reads used the carrier instead of its target
or trap. Implement the shared internal operation with recursive target dispatch,
revocation, descriptor completion, compatibility and protected-property checks.
Retain the trap result and captured target descriptor across guest calls; charge
the step budget for each Proxy traversal. Preserve Object primitive boxing.

Reference: [ECMA-262 10.5.5](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots-getownproperty-p).

The first post-change run passed 55 tests in two files (42841), plus TypeScript
and scoped lint. A requested third path did not exist and was not executed;
the expanded run selects the actual reflection-primitives file, symbol descriptor
tests and the preceding Proxy internal-method tests. That run (53549) completed
successfully: 121 tests across five files, TypeScript and scoped lint all passed.

## Remaining integration

This is not public Proxy support or full descriptor integration. Descriptor
objects that are themselves proxies require the forthcoming HasProperty/Get
operations and descriptor-conversion integration. Object.getOwnPropertyDescriptors,
own-key enumeration, property access, definition and snapshots still need Proxy
dispatch. Full-package validation and publication have not been performed for
this change. Pushes remain paused under the user's release hold.
