# Proxy descriptor enumeration

Seven tests failed on 7619b3d2e (77428): Object.getOwnPropertyDescriptors ignored
Proxy ownKeys/descriptor traps and did not reject revoked proxies. Six cases
compare native JavaScript results and observable trap order.

Capture ownKeys once, then request each own descriptor in order. Skip descriptors
that have disappeared. Preserve symbol and accessor identities without reading
property values. Define __proto__ as data, not as a prototype mutation. Retain the
key list and accumulated descriptors across guest calls; release on every exit.
Keep the synchronous ordinary-object path unchanged.

Reference: [ECMA-262 Object.getOwnPropertyDescriptors](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.getownpropertydescriptors).

Verification: 54 tests across four files, TypeScript and scoped lint passed
(82150). The expanded selection passed 64 tests across three files and final
test-file lint (76189), including direct accumulated-descriptor retention and
cleanup on failure. Other enumeration consumers and public Proxy construction
remain incomplete. No full-package or publication claim.
