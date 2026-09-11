# Descriptor-map enumeration

Six native comparisons failed, with one passing control, on 140914fc5 (79175).
Object.defineProperties and Object.create ignored Proxy descriptor maps. The same
enumeration step filtered ordinary string/symbol keys before getter effects.

Capture all own keys, dispatch Proxy descriptor checks, and test enumerability
when each key is reached. Read and convert every selected descriptor before
starting target definitions. Preserve symbols, order and failure behavior. Retain
keys and accumulated descriptors across guest calls; preserve host-capability
enumeration.

Verification: 62 tests across four files, TypeScript and scoped lint passed
(40905). Expanded partial-definition/revocation tests plus symbol, primitive and
host-object regressions passed 129 tests across five files and final test lint
(3243). Other Proxy consumers, public construction, callable
identity and snapshots remain incomplete.
