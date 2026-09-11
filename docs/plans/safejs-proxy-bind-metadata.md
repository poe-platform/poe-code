# Proxy bind prototype and metadata

Four native-comparison failures demonstrate skipped getPrototypeOf and
getOwnPropertyDescriptor traps during Function.prototype.bind. This loses
custom prototypes, suppresses prototype exceptions, reads length when it is
not an own property, and changes the observable trap order.

Use shared Proxy prototype and descriptor operations in the binding path,
awaiting them before metadata reads. Keep ordinary synchronous SDK binding
available. Retain the target, selected prototype, and bound arguments while
guest traps/getters run, then release them on success or failure.

Ten native comparisons cover plain/nested Proxies, null/custom prototypes,
metadata/receiver ordering, missing own length, infinite length, non-string
names, prototype exceptions, and revocation before/during binding. Existing
ordinary prototype retention and SDK constructor tests provide controls.

The initial focused selection passed 20 tests. Run the broader function and
Proxy snapshot selection, package TypeScript, and scoped lint before commit.
The prototype operation validates its result as object-or-null at runtime;
its broad SandboxValue return type requires narrowing at this caller.

README updated. This is not complete SDK Proxy boundary support or a full
package gate. Pushes and releases remain paused.

The broader function/Proxy snapshot selection passed 318 tests across 13 files.
