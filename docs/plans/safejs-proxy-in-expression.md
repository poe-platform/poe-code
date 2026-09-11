# Proxy membership through the in operator

Five new interpreter tests fail on 5e228870c (88858): direct and inherited
guest-authored traps never run, target properties are missed, protected-property
hiding is accepted and revoked proxies return false instead of throwing.

Route guest in expressions through the shared HasProperty operation. Preserve
the host-capability membership path, which checks existence without reading a
host property. Existing evaluation retains operand and key-conversion order.

The focused selection passed 98 tests across four files (28819), including the
new interpreter cases, Proxy has invariants, maintained in-operator tests and
Reflect tests. The same command completed TypeScript and scoped lint successfully.

With-environment lookup, descriptor presence checks and array callbacks still
use their existing paths and need further Proxy integration. No public Proxy,
snapshot-completeness, full-package success or publication claim is made.
