# Proxy with-environment lookup and deletion

All seven native-comparison cases failed on 2eec2933f (49007). Object binding
lookup skipped Proxy targets and has traps; unqualified deletion never reached
the target or deleteProperty trap. Hidden bindings and unscopables also lacked
the required observable lookup calls.

Use shared HasProperty for object environment lookup while preserving the host
capability path. Dispatch an unqualified delete on a resolved Proxy object
reference through the shared deletion operation. Preserve ordinary binding and
ordinary-object deletion paths.

The first post-change run passes all seven cases (71305), including full native
event sequences for virtual bindings, hidden binding fallback and unscopables.
The expanded run (2932) completed successfully: 64 tests across six files,
TypeScript and scoped lint all passed.

This does not implement Proxy writes through object bindings or asynchronous
array callbacks. Public construction, enumeration and snapshots remain unfinished.
No full-package success, push or release is claimed.
