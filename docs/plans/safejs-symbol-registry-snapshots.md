---
title: Symbol registry snapshots
---

# Symbol registry snapshots

Validated on the built prototype-retention candidate based on 7514010d0:

```js
const symbol = Symbol.for("key");
return () => [symbol === Symbol.for("key"), Symbol.keyFor(symbol)];
```

Run the source, serialize the returned guest closure in a module root, JSON
round-trip the snapshot, restore into a fresh Budget and invoke the restored
closure. Actual result: [false, undefined]. Required result: [true, "key"].
Existing public checkpoint tests replay execution and pass, so they do not
establish direct heap-restoration fidelity for registry state.

The registry is currently a per-Budget Map captured by Symbol's intrinsic
functions. Symbol heap records preserve description and well-known identity,
but intrinsic heap records do not preserve that registry. Restore creates a
fresh intrinsic realm, whose Symbol registry is empty.

Investigate capturing registry state on all relevant Symbol intrinsic origins,
including aliased for/keyFor functions and modified/deleted constructor members.
Keep registry associations weakly attached to their intrinsic owners; do not
introduce a process-global strongly retaining symbol metadata table. Restore
must preserve key/symbol identity, reject duplicate keys or conflicting entries,
and retain data-size accounting. Include independent restore isolation and
registered symbols in object keys, Map entries and private state.

This is a concrete prerequisite for reliable weak-collection key classification,
not an implementation of WeakMap or WeakSet. No runtime change has been made
for this gap yet. Add failing direct-restoration tests before implementation,
after the current prototype-retention regression run and atomic delivery.

Two further direct-restoration probes confirm the alias requirements:

```js
const keyFor = Symbol.keyFor;
const symbol = Symbol.for("key");
Symbol.keyFor = () => "changed";
return () => keyFor(symbol);
```

Actual undefined, required "key".

```js
const make = Symbol.for;
Symbol.for = () => Symbol("other");
const symbol = make("key");
return () => make("key") === symbol;
```

Actual false, required true. Capturing only the current constructor members
would miss the preserved original intrinsic aliases. Associate the registry
with the original intrinsic identities, independent of mutable property tables.

Implementation candidate: weakly associate each original Symbol constructor,
for and keyFor intrinsic with its per-run registry. Intrinsic snapshot records
carry registry keys and symbol references; restore repopulates the new realm's
registry and rejects conflicting copies. Validation rejects duplicate keys,
non-symbol references, mismatched descriptions and invalid intrinsic owners.
No process-global strongly retaining symbol table was introduced.

The three initial direct-restoration regressions failed before implementation
and now pass. Expanded tests cover object/Map keys, private class fields, empty
keys versus local symbols, independent restore isolation, malformed registries,
and bare for/keyFor aliases without a captured constructor. All 80 focused
symbol and registry checks pass in 2.58 seconds. Initial changed-file lint
passed; final lint/types, full package checks, build and CLI validation remain.
This candidate is uncommitted and is not included in a published release.

Final changed-file lint and TypeScript diagnostics pass. The normal build
completed all 70 declared workspace build tasks and root stages, including four
fresh-process SafeJS import checks. The paired real CLI harness passed with
zero spawns, and its screenshot was inspected. A built-SDK direct restoration
probe on Node 18.18.0 returns [true,"key"], matching the required registry state.

The maintained package regression run is active. Its two explicit exclusions
are the uncommitted weak-collection feature probes and the separately documented
host-promise property-admission probe. Neither gap is claimed solved or passing.
All committed package coverage and the new registry regressions remain enabled.

Final regression result: 617 files passed, one skipped; 19,524 tests passed,
41 skipped, no failures, in 346.77 seconds, with the two explicit experimental
probe exclusions above. The snapshot-fidelity improvement is ready for its own
commit and push. A separately validated escaped-alias accounting omission is
tracked in safejs-symbol-registry-accounting.md; snapshot identity tests do not
claim that separate resource-accounting gap is solved.
