# Retain returned Proxy prototypes during invariant checks

Two direct helper tests failed on c516fee8f (4299). A getPrototypeOf trap's
returned object was absent from retained roots while a nested target's
isExtensible trap ran. The failure-path test also reached the missing-retention
assertion before its intended trap error.

Retain the returned prototype throughout target extensibility/prototype invariant
checks. Release on normal return and exceptions. This is a retained-root
accounting correction, not a claim that a native garbage collection was observed.

Verification: 53 tests across five files, TypeScript and scoped lint passed
(31072). The current internal guest-proxy filename selection passed 448 tests
across 30 files (34647), excluding unimplemented public Proxy global tests.
Public construction, callable identity, snapshots and
remaining consumers are incomplete.
