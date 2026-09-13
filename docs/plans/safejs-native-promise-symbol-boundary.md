# Native Promise symbol boundary

## Scope

The existing user regression expects user symbol data to survive native Promise
import without copying host metadata. The current string-only descriptor helper
does not implement that behavior. Do not replace this gap with name-based
filtering or copy private host context into guest data to make a test pass.

## Evidence

Node 22.23.2 diagnostics under two AsyncLocalStorage instances and an async hook
show enumerable `async_id_symbol`, `trigger_async_id_symbol`, and two distinct
`kResourceStore` symbols on a Promise (636ab6). No stored context contents were
printed. A Promise retained after its storage is disabled still has that store
symbol, while a fresh Promise does not (172cec). Sampling a fresh Promise does
not establish a complete set of host-private symbols.

[Node's AsyncLocalStorage implementation](https://raw.githubusercontent.com/nodejs/node/v22.23.0/lib/internal/async_local_storage/async_hooks.js)
creates a separate symbol per storage instance and propagates its value onto
async resources. Symbol descriptions alone do not establish key identity or
ownership; user symbols may have the same description.

An isolated test `native-promise-symbol-boundary.test.ts` adds three user-symbol
identity/descriptor cases, including names colliding with Node metadata, plus
an active/retired context isolation control. It must be run before any proposed
implementation. The full main suite remains fixed while running. No symbol
implementation has been changed, and no general safe ownership discriminator
has yet been established. A future admission design must preserve both user
symbol identity and host context isolation, including replay/capability paths.

The isolated regression completed with the expected three user-symbol failures
and the isolation control passing (29042, terminal 744b01), report
`/tmp/safejs-native-promise-symbol-boundary.json`. Every missing descriptor is
`undefined`; no getter or settlement behavior is needed to reproduce the gap.
This extends the existing user test without changing that test or inventing a
filter based on descriptions. Main gate 40305 remains live and unchanged.

## Explicit admission contract (repair-promise-symbol-admission)

The automatic-copy request reproduces at `40b5ac20e91570772786e5f9cb961881b11d6692`
on Node 22.23.2 / ICU 78.2: the own string descriptor survives; the own symbol
value is `undefined` instead of `42`. Owner: `repair-promise-symbol-admission`,
category `C-PROMISE-SYMBOL`, a SafeJS host-boundary contract gap. This is not a
claim that ECMAScript requires native-to-sandbox copying.

The public API is `admitNativePromiseProperties(promise, keys)` exported from
`index`, `core`, and `workerd`. The host passes the exact caller-owned symbol
keys of existing own data properties. The function returns the same Promise,
without mutating it, and replaces its previous admission set atomically. An
empty list revokes admission for future imports. The registration is weakly
held and copies the list; subsequent caller list mutations do not add authority.
Unregistered symbols remain omitted. Registration does not grant access to
host-private metadata: passing such keys is an explicit host authority grant
and is outside this API's caller-owned-data contract. No ownership claim is
inferred from descriptions, enumerability, fresh Promise samples, or the
currently active async stores.

Descriptors and values are read at each import. Missing or accessor properties
in an explicit list throw TypeError; a selected property changed to an accessor
or deleted before import also throws. Getters and setters are never invoked by
admission. Unselected native accessors remain omitted. String data properties
retain their existing admission policy. Extensibility and data-descriptor flags
are preserved, along with symbol identity and aliases within the imported graph.
Callable values retain the existing explicit capability and replay rules;
merely returning a callable from a host operation does not authorize replay.

Admission applies to bindings, imported native Promises nested in host results,
and persistent realms through the common descriptor helper. A host function's
outer Promise remains its asynchronous operation; return `{ input: promise }`
to expose the native Promise itself as result data. Host global-registry symbols
do not grant access to the host's global symbol registry. Well-known symbols
retain their well-known identity. String length, symbol-description length,
and retained graph limits remain enforced during import, rebinding and replay.

Initial input symbols have explicit graph-node references in recorded host
outcomes (`input-symbol`). This preserves identity when the same admitted
symbol is both a property key/value and a settlement value across original and
completed replay. Resolution requires the run's initial symbol graph; it never
looks up a symbol by description or samples host symbols. Old snapshots without
these references retain their existing representation. Pending settlements
continue to require explicit host-call reconciliation.

Native nonextensibility has a separate backend limitation: on Node 22.23.2,
freezing a Promise before enabling async hooks can make native `p.then(...)`
fail while Node attaches its own async ID. The independent native-process
control records exit 1. The nonextensibility acceptance control creates the
Promise under an enabled hook before freezing it, and then verifies guest
nonextensibility and descriptors. No runtime freeze or hook semantics are
weakened to hide that host limitation.

The unchanged target is ECMA-262 edition 16 (June 2025), ECMA-402 edition 12
(June 2025), and the separately pinned newer APIs in the gap evidence. Normative
anchors are [Promise instances](https://262.ecma-international.org/16.0/#sec-properties-of-promise-instances),
[property keys](https://262.ecma-international.org/16.0/#sec-object-type),
[OrdinaryOwnPropertyKeys](https://262.ecma-international.org/16.0/#sec-ordinaryownpropertykeys),
and [property descriptors](https://262.ecma-international.org/16.0/#sec-property-descriptor-specification-type).
These define guest object behavior; the admission API is the host authority
contract. Pinned Test262 revision remains
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Native engines provide independent
controls, not the specification or a symbol-ownership oracle.

Current commands, red/green receipts, limitations, and delivery disposition are
in [the gap evidence](safejs-gap-closure-evidence.md) and
[task artifacts](repair-promise-symbol-admission/).

### Callback-resume proof authority

Symbol admission for native Promise data does not broaden
`HostCallResumeContext.toSandboxValue`. That converter still rejects symbol
values, unresolved native Promises, ordinary functions and foreign callback
adapters. A package-gate regression exposed the shared converter accepting
symbol values in proofs after general symbol import was enabled. The repair
checks the existing proof-conversion context before admitting a symbol;
unique, global and well-known symbol negative controls reproduce the failure.
Normal host/binding imports still preserve those primitives and admitted
Promise key/value/settlement aliases. This is a host proof-capability contract,
not a claim about ECMAScript symbol support.

The maintained exact SDK export inventory must include
`admitNativePromiseProperties`. Its public contract test requires that `index`,
`core` and `workerd` export the identical registration function, so admission
registered through one entrypoint is shared by the others. The strict export
list remains exact; it is not replaced by a partial match.
