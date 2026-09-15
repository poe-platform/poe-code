# Workerd shared-wrapper transport QA

Follow the exact Workerd version, bundling and local-server steps in [the v9 QA](workerd-qa-v9.md), substituting this entry. Require all nine named controls, including original and replay shared-graph results. No additional host module or IO authority is granted.

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
    let calls = 0;
    const sharedSource =
      "const b=new SharedArrayBuffer(4);save(new Map([[b,b]]));return new Uint8Array(b)[0];";
    const bindings = {
      save(map) {
        calls++;
        new Uint8Array(map.keys().next().value)[0] = 7;
      }
    };
    const shared = await run(sharedSource, { bindings });
    check("shared graph original", shared.ok && shared.returnValue === 7);
    const replay = await run(sharedSource, {
      bindings,
      snapshot: JSON.parse(JSON.stringify(shared.snapshot))
    });
    check("shared graph replay", replay.ok && replay.returnValue === 7 && calls === 1);
    return Response.json({ runtime: "workerd 2026-09-01", icu: "not exposed", rows, ok: true });
  }
};
```
