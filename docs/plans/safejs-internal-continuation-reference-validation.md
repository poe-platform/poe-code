# Internal continuation references in guest data

## Validated scope

Follow-up to the aggregate/weak-key admission investigation. Read-only probe
c8ef0a serializes real suspended operations and substitutes their internal heap
references into an ordinary guest binding. Whole restoration accepts:

- `async-function-driver`, exposing generator, capability, phase and generation.
- `async-generator-driver`, exposing generator, requests, phase, suspension,
  awaitKind and generation.
- `promise-adoption`, returning an internal token with no own string keys.

Probe 458fa7 likewise accepts `async-cleanup`, exposing resources, capability,
phase, failed/failure, needsAwait, hasAwaited and generation. These extend the
already reproduced `promise-aggregate` and `aggregate-entry` cases. No arbitrary
host access or sandbox escape is demonstrated by these observations.

Probe sources, each returning a retained closure for low-level serialization:

```js
const c = Promise.withResolvers();
async function f() { await c.promise; return 1; }
const p = f();
return () => { c.resolve(); return p; };
```

```js
const c = Promise.withResolvers();
async function* f() { await c.promise; yield 1; }
const g = f();
const p = g.next();
return () => { c.resolve(); return p; };
```

```js
const c = Promise.withResolvers();
const d = Promise.withResolvers();
d.resolve(c.promise);
return () => { c.resolve(1); return d.promise; };
```

```js
const c = Promise.withResolvers();
async function f() {
  await using resource = { [Symbol.asyncDispose]() { return c.promise; } };
}
const p = f();
return () => { c.resolve(); return p; };
```

## Fix boundary after the frozen gate

Keep source/tests unchanged until session 15942 is terminal. Add failing
whole-restore regressions for direct and nested guest-data references to all
six validated internal kinds, plus the previously reproduced weak-key cases.
Unmodified captures must still restore and settle correctly.

Extend `validateDumpReferences` with narrow permissions for legitimate internal
links. Inspect both producers and validators for every allowed owner/field;
never permit a reference merely because a nested guest property has that name.
Existing scope, source, construction and thenable restrictions remain intact.

Initial link inventory to verify during implementation:

| Internal target | Legitimate owners/fields |
| --- | --- |
| promise-aggregate | aggregate-entry.aggregate |
| aggregate-entry | aggregate-handler.entry |
| async-function-driver | async-function-handler.driver |
| async-generator-driver | async-generator-handler.driver, guest-generator.driver, promise generatorOwner fields |
| async-cleanup | async-cleanup-handler.cleanup |
| promise-adoption | pending-promise.adoption, adoption-resolver.bridge |

Promise-reaction.aggregate refers to a guest promise, not the internal
promise-aggregate record. Preserve legitimate guest handler closures and
callback identity; they can escape through custom Promise constructors.

Qualify aggregate callbacks, async function/generator continuations, resource
cleanup, adoption, weak snapshots, validation and TypeScript/lint. These checks
must not be replaced by a narrow malformed-record-only test.

All investigation so far was read-only. No fix or release is claimed.

## Implementation after the terminal full gate

Full session 15942 terminated unsuccessfully with 10 failures; all 1,594 source
fingerprints matched afterward. Its freeze ended before implementation began.

The first 18 whole-restore regressions fail specifically because forged direct,
nested and shared references are accepted. Their unmodified snapshots restore
and settle correctly before the rejection assertion (578def).

The initial field-specific guard exposed a missed legitimate path: four checks
failed because scope resource state stores its cleanup link in an ordinary heap
object (`entries.cleanup`). It is not enough to allow cleanup references only
from async-cleanup-handler nodes. Do not whitelist every object.cleanup field.

The current implementation identifies resource-state nodes from scope-frame
resourceState ownership, permits only their immediate cleanup field to refer
to async-cleanup, and rejects guest references to the resource-state node
itself. The adjusted guard passes 47 continuation checks (1a9d3e). Three more
regressions exercise direct, nested and shared resource-state exposure.

The complete snapshot directory finished successfully in session 91101:
2,080 tests across 152 files passed (129.36 seconds, terminal 06aaa6).
TypeScript and focused lint pass after the resource-state adjustment.
A fresh Node 18.20.8 run of the 21 reference regressions and existing async
function continuation checks passed all 50 tests across two files (ce6c6b).

These results qualify the reference-boundary change, not JavaScript completeness
or the full package gate: the last package run still has 10 failures documented
in safejs-post-temporal-full-gate.md. No push or release is authorized during
the release hold. Unrelated staged SafeBash changes remain untouched.
