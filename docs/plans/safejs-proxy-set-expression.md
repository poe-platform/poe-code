# Guest Proxy assignment integration

The first native-comparison selection failed 11 cases on e34b45307 (10526).
Strengthening the super receiver case to assert DefineOwnProperty rather than
Set produced 12 failures and one passing control (16602). Ordinary assignments,
updates, destructuring, inherited traps, setter receiver writes and with bindings
skipped Proxy writes or incorrectly rejected valid references.

Resume assignment at Proxy boundaries reported by ordinary descriptor lookup,
preserving the original receiver. Map false results to strict-mode TypeError or
sloppy-mode ignored writes without changing expression values. Use shared
HasProperty for strict object-binding reassignment checks. Route super assignments
through shared Set when the prototype path or receiver is a Proxy, so an ordinary
super base defines the receiver property instead of invoking the receiver's Set.

The initial post-change selection passed 47 tests across four files, TypeScript
and scoped lint (27356). The maintained assignment, destructuring, accessor,
super, eval update and Object.assign selection passed 345 tests across nine
files (89204).

This is not complete asynchronous array-method integration, Proxy enumeration,
callable identity, public construction or snapshot support. No full-package gate,
push or release is claimed.
