# Callable Proxy host and realm callbacks

Eight focused native comparisons failed before repair. Both the raw host callback
wrapper and retained realm callback invocation called the private Proxy carrier
directly, producing "Proxy calls require runtime dispatch" instead of invoking
the target or apply trap.

Dispatch Proxy callbacks through callGuestProxy with the existing execution
budget and compilation scope. Provide guest property and closure operations so
nested Proxies and accessor-backed traps execute in the guest. The fallback
closure invocation uses a separate caller context to avoid recursive delegation.
Keep ordinary closure invocation unchanged.

Thirteen focused cases pass: forwarding, apply results/logs, nested Proxies,
accessor-backed traps, async targets, revocation, guest errors, explicit realm
receivers, and a real Proxy heap checkpoint before host invocation. The broader
host/realm/callback/replay selection passed 284 tests across 12 files. Scoped
ESLint and package TypeScript passed. The maintained workspace build closure
passed all 23 builds and four fresh-process native import checks.

## Separate validated gap

An ordinary raw host callback with `function(x){return this.y+x}` and native
Reflect.apply receiver `{y:3}`, argument 4 returns 7 natively but TypeError in
SafeJS. The raw wrapper is an arrow and records only callback arguments, not
the receiver. This persists independently of Proxy dispatch; fixing it requires
preserving receiver/argument aliases and defining replay compatibility. The
initial Proxy probe also used this receiver, so the focused Proxy tests were
separated from that already-independent mismatch. This gap remains open; it is
not erased by the passing undefined-receiver controls or the realm bridge tests.

README updated. No CLI presentation changes. The preceding full-package gate
predates this change and has two unresolved host-Promise import-policy failures.
Pushes and releases remain held.
