# Workerd transport checks

Execute these steps from the repository root. This is a manual QA plan, not a QA runner. Use the exact Workerd version; ICU is not exposed. No network, filesystem or other guest module is granted.

1. Materialize `docs/plans/qualify-realms-and-recovery/workerd-entry.mjs` from this fixture:

```js
import { run } from "../../../packages/safe-js/src/workerd.ts";
export default {
  async fetch() {
    const rows = [];
    const check = (name, actual) => {
      if (actual !== true) throw Error(name);
      rows.push(name);
    };
    const key = Symbol("k");
    const value = Object.assign(Object.create(null), { key, [key]: 7 });
    const source = "return Object.getPrototypeOf(value)===null && value[value.key]===7;";
    const result = await run(source, { bindings: { value } });
    check("metadata", result.returnValue);
    check("v9 marker", result.snapshot.executionSemantics === "jobs-v9");
    check(
      "replay",
      (
        await run(source, {
          bindings: { value },
          snapshot: JSON.parse(JSON.stringify(result.snapshot))
        })
      ).returnValue
    );
    const box = Object(7);
    Object.freeze(box);
    check(
      "frozen box",
      (await run("return Object.isFrozen(value);", { bindings: { value: box } })).returnValue
    );
    let reads = 0;
    const bad = Object.create({});
    Object.defineProperty(bad, "constructor", {
      get() {
        reads++;
        throw Error("getter");
      }
    });
    let rejected = false;
    try {
      await run("return value;", { bindings: { value: bad } });
    } catch (error) {
      rejected = error.message.includes("Unsupported sandbox value");
    }
    check("safe rejection", rejected && reads === 0);
    const map = new Map([[1, 2]]);
    Object.defineProperty(map, "self", { value: map });
    Object.freeze(map);
    check(
      "collection metadata",
      (
        await run("return value.self===value && Object.isFrozen(value) && value.get(1)===2;", {
          bindings: { value: map }
        })
      ).returnValue
    );
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          traps++;
          throw Error("trap");
        },
        has() {
          traps++;
          throw Error("trap");
        }
      }
    );
    let proxyRejected = false;
    try {
      await run("return read();", { bindings: { read: () => Object.create(proxy) } });
    } catch (error) {
      proxyRejected = error.message.includes("proxy");
    }
    check("proxy prototype denial", proxyRejected && traps === 0);
    return Response.json({ runtime: "workerd 2026-09-01", icu: "not exposed", rows, ok: true });
  }
};
```

2. Materialize `workerd.capnp` in the same directory:

```capnp
using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [(name = "main", worker = (modules = [(name = "workerd-bundle.mjs", esModule = embed "workerd-bundle.mjs")], compatibilityDate = "2026-09-01", compatibilityFlags = ["nodejs_compat"]))],
 sockets = [(name = "http", address = "127.0.0.1:37894", http = (), service = "main")]
);
```

3. Bundle the entry with esbuild: `bundle: true`, `platform: "neutral"`, `format: "esm"`, `conditions: ["workerd"]`, `external: ["node:*"]`, and output `workerd-bundle.mjs`. Record the metafile and SHA-256. `workerd-build-v9.json` and `workerd-artifact-v9.json` preserve the observed build.
4. Run `npm exec --yes --package=workerd@1.20260901.1 -- workerd --version`, then `npm exec --offline --package=workerd@1.20260901.1 -- workerd serve docs/plans/qualify-realms-and-recovery/workerd.capnp`.
5. Request `curl --fail --silent --show-error http://127.0.0.1:37894/`. Require `ok:true` and the seven named rows. `workerd-response-v9.json` is the actual response, not expected-output text.
6. Stop only the task-owned Workerd process. Remove the generated entry/config/bundle after recording hashes; keep this plan and the receipts.

This checks the maintained Workerd `run` surface and its JSON snapshot input. It does not infer persistent `createRealm` or migration exports that this entry does not expose.
