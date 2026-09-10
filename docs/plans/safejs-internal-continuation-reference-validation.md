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
