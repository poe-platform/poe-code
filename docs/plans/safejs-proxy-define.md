# Proxy property definition

The initial Object/Reflect native-comparison matrix produced 25 failures and
two passing controls on c40ff23cf (65514). Definitions changed the carrier,
ignored traps and refusal, missed target invariants and did not forward nested
or array-length definitions.

Dispatch Proxy targets from the maintained defineDataProperty path. Capture and
retain descriptor values/accessors across trap lookup. Expose a separate guest
descriptor with only supplied fields, in FromPropertyDescriptor order, restoring
guest accessor identities. Trap mutation must not mutate the internal descriptor.
False results short-circuit target inspection. Truthy results validate captured
post-trap target descriptors and extensibility, including explicit non-configurable
and newly non-writable claims. Missing traps use the existing target definition
path, preserving array and typed-array handling. Object throws on refusal while
Reflect returns false.

Reference: [ECMA-262 10.5.6](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots-defineownproperty-p-desc).

The first selection passed 129 tests across four files, TypeScript and scoped
lint (13413). Expanded accessor-identity, descriptor mutation/order, symbol and
refusal controls plus maintained accessor/extensibility tests passed 248 tests
across four files (66846); final test-file lint also completed successfully.

Proxy Set, enumeration, callable identity, public construction and snapshots
remain incomplete. No full-package gate, push or release is claimed.
