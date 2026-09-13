# Workerd Promise admission qualification

Source base `4408e49a0c4ac0cdddc9af2b59cd772950d6ca08` plus the committed narrow SafeFS imports. Node 22.23.2, ICU 78.2; workerd@1.20260901.1 reports workerd 2026-09-01. Workerd does not expose its ICU version.

Create this temporary worker source, updating only the absolute repository path:

```js
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { run, admitNativePromiseProperties } from '/Users/kjopek/Workspace/poe-code/packages/safe-js/dist/workerd.js';
export default { async fetch() {
  const checks = [];
  for (const surface of ['binding', 'host']) {
    const storage = new AsyncLocalStorage();
    const unique = Symbol('kResourceStore'), global = Symbol.for('async_id_symbol');
    const input = storage.run({ secret: 'host-context-secret' }, () => Promise.resolve(unique));
    const shared = { input };
    for (const [key, value] of [[unique, shared], [global, shared], [Symbol.toStringTag, 'CallerPromise']]) Object.defineProperty(input, key, { value });
    let calls = 0;
    const accessor = Symbol('accessor');
    Object.defineProperty(input, accessor, { get() { calls++; return 100; } });
    assert.throws(() => admitNativePromiseProperties(input, [accessor]), TypeError);
    const prefix = surface === 'host' ? 'const input = (await load()).input; ' : '';
    const bindings = surface === 'host' ? { load: () => ({ input }) } : { input };
    assert.deepEqual((await run(prefix + 'return Object.getOwnPropertySymbols(input).length', { bindings })).returnValue, 0);
    admitNativePromiseProperties(input, [unique, global, Symbol.toStringTag]);
    Object.preventExtensions(input);
    const result = await run(prefix + `const keys = Object.getOwnPropertySymbols(input); return [keys.length, input[keys[0]] === input[keys[1]], input[keys[0]].input === input, keys[2] === Symbol.toStringTag, input[keys[2]], Object.isExtensible(input), Object.getOwnPropertyDescriptor(input, keys[0]).writable, await input === keys[0]];`, { bindings });
    assert.equal(result.ok, true);
    assert.deepEqual(result.returnValue, [3,true,true,true,'CallerPromise',false,false,true]);
    assert.equal(calls,0);
    checks.push({surface, passed:true, accessorCalls:calls});
  }
  return Response.json({runtime:'workerd',icu:'not exposed',checks});
}};
```

Bundle with esbuild: `entryPoints: [workerSource], bundle: true, platform: "neutral", format: "esm", conditions: ["workerd"], external: ["node:*"], outfile: workerOutput`. No native-seek external or replacement module is permitted.

```capnp
using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [(name = "main", worker = (modules = [(name = "worker.mjs", esModule = embed "worker.mjs")], compatibilityDate = "2026-09-01", compatibilityFlags = ["nodejs_compat"]))],
 sockets = [(name = "http", address = "127.0.0.1:37652", http = (), service = "main")]
);
```

Run `npm exec --yes --package=workerd@1.20260901.1 -- workerd serve <config>` then `curl --fail --silent --show-error http://127.0.0.1:37652/`. Both binding and nested host-result cases pass with zero accessor calls. Native Promise symbols remain omitted until explicitly admitted; the admitted unique/global/well-known graph, descriptors, cycles, nonextensibility and settlement identity survive. Node compatibility is host harness authority only. Workerd warns that nodejs_compat became default at this compatibility date. Active/retired AsyncLocalStorage metadata isolation remains independently covered by the Node tests; Workerd has no native disable API. This control does not claim Workerd dump/restore or persistent-realm APIs that its public entry does not expose.
