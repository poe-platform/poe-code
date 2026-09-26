import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";

test("Workerd public entry bundles without native filesystem authority", async () => {
  const result = await build({
    entryPoints: ["workerd", "core", "modules/fs"].map(name => new URL(`../dist/${name}.js`, import.meta.url).pathname),
    bundle: true, platform: "neutral", format: "esm", conditions: ["workerd"],
    outdir: "/tmp/safe-js-portable", write: false, metafile: true
  });
  assert.ok(result.outputFiles.length > 0);
  assert.equal(Object.keys(result.metafile.inputs).some(name => name.includes("native-seek")), false);
});

test("portable SDK executes without Node globals or shared memory", async () => {
  const directory = new URL("../dist/", import.meta.url).pathname;
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
});

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
test("built platform resolution does not add a nested canonical filesystem package scope", () => {
  assert.equal(existsSync(new URL("../dist/package.json", import.meta.url)), false);
});
for (const [name, entry] of Object.entries(manifest.exports)) {
  test(`built ${name} export initializes in a fresh native ESM process`, () => {
    const url = new URL(`../${entry.import}`, import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)})`], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  });
}

test("built SDK and snapshot helpers initialize together without preloading value modules", () => {
  const entry = name => JSON.stringify(new URL(`../dist/${name}.js`, import.meta.url).href);
  const source = `
    import { run } from ${entry("index")};
    import { serializeSafeJSSnapshot } from ${entry("snapshot/dump-format")};
    import { restore } from ${entry("restore")};
    if ([run, serializeSafeJSSnapshot, restore].some(value => typeof value !== "function")) throw new Error("Missing exports");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

test("built replay-data helpers initialize without preloading the SDK", () => {
  const url = new URL("../dist/snapshot/replay-data.js", import.meta.url).href;
  const source = `const {encodeReplayData,decodeReplayData}=await import(${JSON.stringify(url)});
    if(decodeReplayData(encodeReplayData(7))!==7)throw new Error("Replay data round trip failed");`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

test("built data accounting retains optimized code across garbage collections", () => {
  const entry = name => JSON.stringify(new URL(`../dist/interp/${name}.js`, import.meta.url).href);
  const source = `
    import { measureSandboxData, createSandboxClosure } from ${entry("values")};
    import { createIntrinsicArray } from ${entry("object-model")};
    const child = { text: "text" };
    const roots = Array.from({ length: 1200 }, (_, index) => index % 3 === 0
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
  const result = spawnSync(process.execPath, ["--expose-gc", "--trace-opt", "--input-type=module", "-e", source], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const sections = result.stdout.split("MEASUREMENT_WARMED");
  assert.equal(sections.length, 2, "Missing warmup boundary");
  const optimizations = output => output.split("\n").filter(line =>
    line.includes("completed optimizing") && line.includes("<JSFunction visit ")).length;
  assert.ok(optimizations(sections[0]) > 0, "Visitor did not optimize during warmup");
  // One final warmup compilation may finish asynchronously. Recompiling after
  // every collection makes the large live browser graph repeatedly pay for JIT.
  assert.ok(optimizations(sections[1]) <= 1, `Visitor reoptimized ${optimizations(sections[1])} times after warmup`);
});

test("built data accounting releases first-call roots and preserves native observations", () => {
  const url = JSON.stringify(new URL("../dist/interp/values.js", import.meta.url).href);
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
});

test("built scope accounting records retain fast fields without inherited metadata", () => {
  const url = JSON.stringify(new URL("../dist/interp/scope-data-roots.js", import.meta.url).href);
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
});

for (const edge of ["target", "handler"]) {
  test(`built Proxy accounting handles a cold ${edge} chain through the data-depth limit`, () => {
    const entry = name => JSON.stringify(new URL(`../dist/${name}.js`, import.meta.url).href);
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
  });
}
