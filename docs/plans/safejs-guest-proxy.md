# Guest Proxy implementation

Proxy is a confirmed missing guest global. The runtime has private native
proxies for its own property tables; those are not a guest Proxy implementation.

## Requirements and implementation boundaries

Use [ECMA-262 Proxy internal methods](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots)
as the normative reference. All thirteen internal-method traps need fallback,
receiver/handler identity, result validation and invariant enforcement. Callable
and constructible identity follow the target. Revocation invalidates operations
and releases target/handler references, but does not change typeof.

Start with native-backed tests for the public constructor, ordinary forwarding,
all trap families, revoked behavior, symbols, array identity and invariant errors.
These are requirements for one missing feature, not separate validated bugs.
Add snapshot, budget, host-boundary and CLI lint coverage before delivery.

The guest handler must run through the interpreter's normal call/budget machinery.
Do not pass raw guest closures to a native Proxy or let synchronous host descriptor
walks accidentally invoke asynchronous guest code. Existing get/set/has/descriptor/
prototype/key operations must dispatch consistently, including inherited proxies,
Reflect/Object methods, spread, destructuring, iteration and callable wrappers.
Keep private target/handler state outside guest-visible property tables.

Memory accounting must retain target/handler only while reachable, and revocation
must drop those edges. Snapshots need explicit proxy state and cycles, including
revokers and callable targets. Forged snapshots must be rejected. A get-only
facade is not completed Proxy support; do not expose or publish a partial API as
the finished feature.

Initial native-backed requirement run 64485 fails all 32 guest cases; the native
oracle evaluates all cases successfully before each guest assertion. This
confirms the missing feature, not 32 independently diagnosed defects.
Implementation is not yet added. The committed dynamic/eval candidate remains frozen for 75555;
these tests and future proxy work belong only to main until independently ready.

## Private state and accounting foundation

Added private weakly keyed target/handler records and validated, idempotent
revocation. Records are not guest-visible own properties. No public Proxy global
is installed yet; callable carriers, trap dispatch and snapshots remain required.

The initial private-state suite failed to import the absent module (24983).
After state/revocation implementation, 16 tests passed and two accounting tests
failed (96934): usage was 1 instead of 313 for retained payloads and 1 instead of
7 for a cycle. The existing memory visitor now follows target/handler strong
edges once and stops retaining them after revocation. All 54 state, value and
weak-accounting tests pass across three files (75229). TypeScript and scoped
lint also pass (84229, exit 0). The 32 public Proxy requirements remain red and must
not be reported as implemented by this private foundation.

## Trap lookup foundation

The shared operation wrapper captures active target/handler references before
calling the guest property reader, checks nullish versus callable traps, and
retains captured state and the resolved trap through the operation. Finally
cleanup runs after successful asynchronous completion or any error. Native
functions are not accepted as guest traps. Getter-side revocation affects later
operations without erasing the current operation's captured references.

All 12 new requirements failed before the wrapper existed (21081). After its
implementation, 55 private-state/trap/value tests pass (68009). TypeScript and
scoped lint also pass (97964). No public trap family or Proxy constructor is wired yet.

After committed-feature full run 75555 passed and its unchanged hash was
verified, the isolated checkout was advanced with only this private Proxy
foundation (not experimental weak changes or public Proxy tests). Its 55 focused
tests, chained TypeScript and lint also pass (34117, exit 0). The
new source set is not covered by the earlier passing full-run manifest.
