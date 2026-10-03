import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {LuaStorage} from "./lua-storage.js";
import {LuaJsonBridge} from "./lua-json.js";
import {ExecutionContext} from "./execution.js";

async function usingBridge(run: (bridge: LuaJsonBridge, heap: LuaStorage, input: BackedJson, output: BackedJson) => Promise<void>, signal?: AbortSignal) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", signal ? {signal} : {});
  const owner = {fs, cwd: "/", env: {}, signal: signal ?? new AbortController().signal};
  const stores = Array.from({length: 4}, () => new PagedStorage(owner, 1));
  const cooperate = (units?: number) => context.cooperate(units);
  const heap = new LuaStorage(stores[0]!, cooperate);
  const bridge = new LuaJsonBridge(heap, stores[1]!, cooperate);
  try {await run(bridge, heap, new BackedJson(stores[2]!, cooperate), new BackedJson(stores[3]!, cooperate));}
  finally {for (const store of stores) await store.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
}
async function json(tree: BackedJson): Promise<string> {
  let result = "";
  for await (const bytes of tree.chunks()) {expect(bytes.length).toBeLessThanOrEqual(16384); result += new TextDecoder().decode(bytes);}
  return result;
}
it("bridges retained trees and Lua values without losing nulls, empty containers or binary UTF-8 boundaries", async () => {
  await usingBridge(async (bridge, heap, input, output) => {
    const value = {blocks: [{t: "Str", c: "x".repeat(4095) + "😀" + "é".repeat(20000)}], meta: {}, empty: [], nullable: null, flags: [true, false, -1.25]};
    await input.value(value);
    const stored = await bridge.read(input);
    if (typeof stored !== "object") throw new Error("Expected table");
    const key = await heap.string([new TextEncoder().encode("flags")]);
    const flags = await heap.get(stored, key);
    if (typeof flags !== "object") throw new Error("Expected flags");
    await heap.set(flags, 2, true);
    await bridge.write(stored, output);
    expect(JSON.parse(await json(output))).toEqual({...value, flags: [true, true, -1.25]});
  });
});
it("moves deeply nested trees using backed traversal state", async () => {
  await usingBridge(async (bridge, _heap, input, output) => {
    for (let i = 0; i < 1200; i++) await input.begin("array");
    await input.value("leaf");
    for (let i = 0; i < 1200; i++) await input.end();
    await bridge.write(await bridge.read(input), output);
    expect(await json(output)).toBe("[".repeat(1200) + '"leaf"' + "]".repeat(1200));
  });
});
it("orders numeric Lua keys while allowing a shared noncyclic child", async () => {
  await usingBridge(async (bridge, heap, _input, output) => {
    const root = await heap.table(), child = await heap.table();
    await heap.set(child, 2, false); await heap.set(child, 1, true);
    await heap.set(root, 2, child); await heap.set(root, 1, child);
    await bridge.write(root, output);
    expect(await json(output)).toBe("[[true,false],[true,false]]");
  });
});
it.each(["cycle", "sparse", "mixed", "boolean-key", "nonfinite", "invalid-utf8"])("rejects invalid Lua replacements: %s", async scenario => {
  await usingBridge(async (bridge, heap, _input, output) => {
    const value = await heap.table();
    if (scenario === "cycle") await heap.set(value, 1, value);
    if (scenario === "sparse") await heap.set(value, 2, true);
    if (scenario === "mixed") {
      await heap.set(value, 1, true);
      await heap.set(value, await heap.string([Uint8Array.of(120)]), true);
    }
    if (scenario === "boolean-key") await heap.set(value, false, true);
    if (scenario === "nonfinite") await heap.set(value, 1, Infinity);
    if (scenario === "invalid-utf8") await heap.set(value, 1, await heap.string([Uint8Array.of(255)]));
    await expect(bridge.write(value, output)).rejects.toMatchObject({code: "E_AST"});
  });
});


it.each(["read", "write"])("observes timer cancellation during a long retained string %s and cleans storage", async operation => {
  const controller = new AbortController();
  await usingBridge(async (bridge, _heap, input, output) => {
    await input.value("x".repeat(100000));
    const value = operation === "write" ? await bridge.read(input) : undefined;
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await expect(operation === "read" ? bridge.read(input) : bridge.write(value, output)).rejects.toMatchObject({code: "E_CANCELLED"});
    } finally {clearTimeout(timer);}
  }, controller.signal);
});
it.each(["\ud800", "\udc00", "x\ud800y"])("rejects invalid Unicode at the JSON-to-Lua boundary", async text => {
  await usingBridge(async (bridge, _heap, input) => {
    await input.value(text);
    await expect(bridge.read(input)).rejects.toMatchObject({code: "E_AST"});
  });
});
it("reports numeric policy rejection as an AST error", async () => {
  await usingBridge(async (bridge, _heap, input) => {
    await input.begin("literal"); await input.text("1e100"); await input.end();
    await expect(bridge.read(input)).rejects.toMatchObject({code: "E_AST"});
  });
});
