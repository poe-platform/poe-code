# Manual qualification

Run from the repository root after the maintained SafeJS workspace build.
The exact source for the seven-runtime, three-entrypoint probe is the `source`
field in `public-smoke-command.json`; the exact executable arguments and exit
codes are in `public-runtime-matrix.json`. Every stdout records the actual
runtime and ICU version. Re-execute each matrix command with `-e` followed by
that source. Do not substitute a published predecessor for the local build.

For the independent nonextensibility backend control, execute:

```sh
node --input-type=module -e 'import { createHook } from "node:async_hooks"; const p = Object.preventExtensions(Promise.resolve(7)); const hook = createHook({init(){}}).enable(); p.then(() => {}); hook.disable();'
```

Node 22.23.2 exits 1 in its native async ID attachment. Inspect
`native-nonextensible-control.log`. The acceptance tests separately initialize
native hooks before freezing, and require nonextensibility after import.

To repeat pending callable qualification on both public boundaries, execute:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { admitNativePromiseProperties, run, dump, restore } from './packages/safe-js/dist/index.js';
for (const surface of ['binding', 'host']) {
  let settle;
  const input = new Promise(resolve => { settle = resolve; });
  const key = Symbol('callable');
  const first = () => 1;
  Object.defineProperty(input, key, { value: first });
  admitNativePromiseProperties(input, [key]);
  let reached;
  const ready = new Promise(resolve => { reached = resolve; });
  const load = () => ({ input });
  const source = (surface === 'host' ? 'const input = (await load()).input; ' : '') + 'mark(); const value = await input; const key = Object.getOwnPropertySymbols(input)[0]; return [input[key](), value]';
  const execution = run(source, { bindings: surface === 'host' ? { first, load, mark: reached } : { first, input, mark: reached } });
  try {
    await ready;
    await execution.pause();
    const snapshot = restore(JSON.parse(await dump(execution)), { source });
    const resumed = await run(source, { snapshot, bindings: { first: () => 2, load, mark: () => {} }, hostCallResumeProvider: request => ({ ...request, outcome: { status: 'fulfilled', value: 9 } }) });
    assert.equal(resumed.ok, true);
    assert.deepEqual(resumed.returnValue, [2, 9]);
    settle(7);
    execution.resume();
    const original = await execution;
    assert.deepEqual(original.returnValue, [1, 7]);
    const completed = await run(source, { bindings: { first: () => 3, load, mark: () => {} }, snapshot: restore(JSON.parse(await dump(original)), { source }) });
    assert.deepEqual(completed.returnValue, [1, 7]);
    console.log(surface, 'original, pending callable rebind, completed replay: passed');
  } finally {
    settle(7);
    if (execution.executionState === 'paused') execution.resume();
    await execution;
  }
}
JS
```

The recorded execution passed both surfaces (`pending-callable.log`). This
explicitly supplies replacement authority for a callable that has not executed
at the pending checkpoint, and checks that completed history does not invoke
the replacement again.

For collision qualification, create an own string callable under
`'["symbol",1]'` returning 3 and an admitted symbol callable returning 4 on the
same Promise. Bind that Promise, invoke both properties and await it, and repeat
from a completed dump with the binding supplied. Require `[3, 4, 7]` on both
runs (`callable-collision.log`); equal descriptions or string spellings must not
merge capability identities.

## Admission replacement and realm lifetime controls

Run this independent public API control from the repository root. An invalid
replacement must retain previous authority; revocation affects future imports
but cannot revoke a graph already imported into a persistent realm. The guest
symbol registry must not acquire the host global symbol's registration.

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { admitNativePromiseProperties, createRealm, run } from './packages/safe-js/dist/index.js';
const first = Symbol.for('admission-independent-control');
const second = Symbol('admission-independent-control');
const input = Promise.resolve(3);
let invoked = 0;
Object.defineProperty(input, first, { value: 11 });
Object.defineProperty(input, second, { get() { invoked++; return 99; } });
admitNativePromiseProperties(input, [first, first]);
assert.throws(() => admitNativePromiseProperties(input, [second]), TypeError);
const source = '{ const keys = Object.getOwnPropertySymbols(input); return [keys.length, input[keys[0]], Symbol.keyFor(keys[0]), await input]; }';
const original = await run(source, { bindings: { input } });
assert.equal(original.ok, true);
assert.deepEqual(original.returnValue, [1, 11, undefined, 3]);
const realm = createRealm({ bindings: { input } });
try {
  assert.deepEqual((await realm.evaluate(source)).returnValue, [1, 11, undefined, 3]);
  admitNativePromiseProperties(input, []);
  assert.deepEqual((await realm.evaluate(source)).returnValue, [1, 11, undefined, 3]);
  assert.deepEqual((await run('return Object.getOwnPropertySymbols(input).length', { bindings: { input } })).returnValue, 0);
  assert.equal(invoked, 0);
} finally { await realm.close(); }
console.log('atomic replacement, deduplication, registry isolation, realm lifetime, revocation, getter noninvocation: passed');
JS
```
