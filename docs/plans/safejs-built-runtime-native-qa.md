# Built SafeJS native runtime QA

Run after changing built exports, portable runtime behavior, data accounting, native observations or Proxy depth limits. The automatic postbuild route retains the fast Workerd bundle and canonical package-scope checks. Execute all thirteen native-process checks below separately from unit coverage.

1. Run `npm run build`.
2. Use native Node with its default stack and import the setup below from the repository root. Keep temporary execution evidence in `out/`.
3. Execute each numbered fragment, including every export and both Proxy edges. Preserve every assertion, native flag, timeout and buffer limit. Each subprocess must exit zero; a timeout is a failed attempt, never a pass. Investigate host startup delays before repeating an unchanged case.
4. Record all thirteen outcomes, then purge temporary evidence. Do not replace native implementations with mocks.

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const sourceFile = pathToFileURL(path.resolve("packages/safe-js/scripts/built-imports.test.mjs"));
const manifest = JSON.parse(readFileSync(new URL("../package.json", sourceFile), "utf8"));
```

## 1. portable SDK executes without Node globals or shared memory

Execute this fragment with the setup above.

```js
const directory = new URL("../dist/", sourceFile).pathname;
const result = await build({
    stdin: { contents: `import { run, makeFsModule } from "./workerd.js";
      import { createRealm, createRootedSourceResolver } from "./core.js";
      import { MemoryFileSystem } from "@poe-code/safe-fs/core";
      export { run, makeFsModule, createRealm, createRootedSourceResolver, MemoryFileSystem };`, resolveDir: directory },
    bundle: true, platform: "neutral", format: "esm", conditions: ["workerd"], write: false
  });
const url = "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64");
const script = `globalThis.process = undefined; globalThis.Buffer = undefined;
    globalThis.SharedArrayBuffer = undefined;
    const { run, createRealm, createRootedSourceResolver, makeFsModule, MemoryFileSystem } = await import(${JSON.stringify(url)});
    const fs = new MemoryFileSystem();
    await fs.writeFile("/value", new TextEncoder().encode("portable"));
    const modules = { fs: makeFsModule({ adapter: fs, readFileMaxBytes: Infinity, hostReadMemoryLimit: Infinity }) };
    const result = await run('import {readFile} from "fs"; return await readFile("/value", "utf8");', { modules });
    if (result.returnValue !== "portable") throw new Error("Portable filesystem read failed");
    await fs.mkdir("/source");
    await fs.writeFile("/source/value.ajs", new TextEncoder().encode("export const value = 42;"));
    const resolver = await createRootedSourceResolver("/source", fs);
    const imported = await run('export {value} from "./value.ajs";', {
      sourceType: "module", filename: await resolver.entryId(), sourceResolver: resolver
    });
    if (imported.returnValue.value !== 42) throw new Error("Portable source import failed");
    const realm = createRealm();
    try {
      if ((await realm.evaluate("return await Promise.resolve(42);")).returnValue !== 42) throw new Error("Portable realm failed");
    } finally { await realm.close(); }
  `;
const execution = spawnSync(process.execPath, ["--input-type=module"], { input: script, encoding: "utf8", timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
assert.equal(execution.status, 0, execution.stderr.slice(-4000) || String(execution.error));
```

## 2. Fresh native ESM exports

Execute this fragment with the setup above.

```js
for (const [name, entry] of Object.entries(manifest.exports)) {
const url = new URL(`../${entry.import}`, sourceFile).href;
const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)})`], { encoding: "utf8", timeout: 5000 });
assert.equal(result.status, 0, result.stderr || String(result.error));
}
```

## 3. built SDK and snapshot helpers initialize together without preloading value modules

Execute this fragment with the setup above.

```js
const entry = name => JSON.stringify(new URL(`../dist/${name}.js`, sourceFile).href);
const source = `
    import { run } from ${entry("index")};
    import { serializeSafeJSSnapshot } from ${entry("snapshot/dump-format")};
    import { restore } from ${entry("restore")};
    if ([run, serializeSafeJSSnapshot, restore].some(value => typeof value !== "function")) throw new Error("Missing exports");
  `;
const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 5000 });
assert.equal(result.status, 0, result.stderr || String(result.error));
```

## 4. built replay-data helpers initialize without preloading the SDK

Execute this fragment with the setup above.

```js
const url = new URL("../dist/snapshot/replay-data.js", sourceFile).href;
const source = `const {encodeReplayData,decodeReplayData}=await import(${JSON.stringify(url)});
    if(decodeReplayData(encodeReplayData(7))!==7)throw new Error("Replay data round trip failed");`;
const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 5000 });
assert.equal(result.status, 0, result.stderr || String(result.error));
```

## 5. built data accounting retains optimized code across garbage collections

Execute this fragment with the setup above.

```js
const entry = name => JSON.stringify(new URL(`../dist/interp/${name}.js`, sourceFile).href);
const source = `
    import { measureSandboxData, createSandboxClosure } from ${entry("values")};
    import { createIntrinsicArray } from ${entry("object-model")};
    const child = { text: "text" };
    const roots = Array.from({ length: 120 }, (_, index) => index % 3 === 0
      ? createSandboxClosure({ call: () => undefined, retainedValues: () => [child] })
      : index % 3 === 1 ? createIntrinsicArray([child, "text"]) : { child, name: "record" });
    const expected = measureSandboxData(roots);
    for (let pass = 0; pass < 8; pass++) {
      for (let index = 0; index < 100; index++)
        if (measureSandboxData(roots) !== expected) throw new Error("Accounting changed");
      if (pass === 1) console.log("MEASUREMENT_WARMED");
      globalThis.gc();
      await new Promise(resolve => setImmediate(resolve));
    }
  `;
const result = spawnSync(process.execPath, ["--expose-gc", "--trace-opt", "--no-concurrent-recompilation", "--input-type=module", "-e", source], { encoding: "utf8", timeout: 10000 });
assert.equal(result.status, 0, result.stderr || String(result.error));
const sections = result.stdout.split("MEASUREMENT_WARMED");
assert.equal(sections.length, 2, "Missing warmup boundary");
const optimizations = output => output.split("\n").filter(line =>
    (line.includes("completed optimizing") || (line.includes("completed compiling") && line.includes("target TURBOFAN"))) && line.includes("<JSFunction visit ")).length;
assert.ok(optimizations(sections[0]) > 0, "Visitor did not optimize during warmup");
assert.ok(optimizations(sections[1]) <= 1, `Visitor reoptimized ${optimizations(sections[1])} times after warmup`);
```

## 6. built data accounting releases first-call roots and preserves native observations

Execute this fragment with the setup above.

```js
const url = JSON.stringify(new URL("../dist/interp/values.js", sourceFile).href);
const source = `
    import assert from "node:assert/strict";
    import { measureSandboxData } from ${url};
    function measure() {
      const root = { text: "payload" };
      const ticket = {};
      const options = { compileTickets: new Set([ticket]) };
      const values = { root, *[Symbol.iterator]() { yield "abc"; } };
      const iterator = Array.prototype[Symbol.iterator];
      const NativeSet = globalThis.Set;
      let arrays = 0, sets = 0, units;
      Array.prototype[Symbol.iterator] = function () { arrays++; return iterator.call(this); };
      globalThis.Set = class extends NativeSet {
        constructor(iterable) { super(iterable); sets++; }
      };
      try { units = measureSandboxData(values, options); }
      finally { Array.prototype[Symbol.iterator] = iterator; globalThis.Set = NativeSet; }
      assert.equal(units, 3);
      assert.equal(arrays, 0, "Initialization introduced native iterator calls");
      assert.equal(sets, 1, "Initialization introduced native Set calls");
      measureSandboxData([root]);
      return [new WeakRef(root), new WeakRef(ticket), new WeakRef(options)];
    }
    const references = measure();
    for (let index = 0; index < 8; index++) {
      await new Promise(resolve => setImmediate(resolve));
      globalThis.gc();
    }
    for (const reference of references) assert.equal(reference.deref(), undefined);
  `;
const result = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", source], { encoding: "utf8", timeout: 10000 });
assert.equal(result.status, 0, result.stderr || String(result.error));
```

## 7. built scope accounting records retain fast fields without inherited metadata

Execute this fragment with the setup above.

```js
const url = JSON.stringify(new URL("../dist/interp/scope-data-roots.js", sourceFile).href);
const source = `
    import assert from "node:assert/strict";
    import { scopeDataRoots } from ${url};
    const child = { text: "old" };
    const cases = [
      { value: child },
      { values: [child] },
      { arguments: { read: () => undefined, capture: () => undefined } },
      { deferred: { chargeIdentity: {}, read: () => undefined, collect: () => {} } }
    ];
    const setPrototypeOf = Object.setPrototypeOf;
    const keys = ["value", "values", "arguments", "deferred"];
    try {
      // Native hooks installed after SDK initialization must never receive a
      // private record, even briefly during construction.
      Object.setPrototypeOf = () => { throw new Error("Private record escaped"); };
      for (const key of keys)
        Object.defineProperty(Object.prototype, key, { __proto__: null, configurable: true, get() { throw new Error("Inherited metadata read"); } });
      for (const data of cases) {
        const root = {};
        scopeDataRoots.set(root, data);
        const record = scopeDataRoots.get(root);
        assert.equal(Object.getPrototypeOf(record), null);
        assert.equal(Object.isFrozen(record), true);
        assert.deepEqual(Reflect.ownKeys(record), Reflect.ownKeys(data));
        assert.ok(%HasFastProperties(record), "Scope accounting record uses dictionary fields");
      }
    } finally {
      Object.setPrototypeOf = setPrototypeOf;
      for (const key of keys) Reflect.deleteProperty(Object.prototype, key);
    }
    assert.equal(Object.isFrozen(child), false);
    child.text = "changed";
    assert.equal(child.text, "changed");
  `;
const result = spawnSync(process.execPath, ["--allow-natives-syntax", "--input-type=module", "-e", source], { encoding: "utf8", timeout: 5000 });
assert.equal(result.status, 0, result.stderr || String(result.error));
```

## 8. Cold Proxy target and handler chains

Execute this fragment with the setup above.

```js
for (const edge of ["target", "handler"]) {
const entry = name => JSON.stringify(new URL(`../dist/${name}.js`, sourceFile).href);
const source = `
      import assert from "node:assert/strict";
      import { MAX_DATA_DEPTH } from ${entry("graph-depth")};
      import { measureSandboxData } from ${entry("interp/values")};
      import { createGuestProxy } from ${entry("interp/guest-proxy")};
      function chain(length) {
        const shared = {};
        let value = {};
        for (let index = 0; index < length; index++)
          value = ${JSON.stringify(edge)} === "target" ? createGuestProxy(value, shared) : createGuestProxy(shared, value);
        return value;
      }
      assert.equal(measureSandboxData([chain(MAX_DATA_DEPTH)]), MAX_DATA_DEPTH + 2);
      assert.throws(() => measureSandboxData([chain(MAX_DATA_DEPTH + 1)]), { code: "budgetExceeded", budget: "dataDepth" });
    `;
const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 5000 });
assert.equal(result.status, 0, result.stderr || String(result.error));
}
```

## Verified execution

All thirteen native cases, plus the two retained automatic checks, passed unchanged on 27 September 2026 with Node 22.22.2, including the exact 1 GiB heap setting used by complete verification. Native flags, default stack and all original assertions were preserved. Full runs demonstrated that shared-host startup can exceed the original five-second subprocess limits; those limits remain unchanged in this QA plan.
