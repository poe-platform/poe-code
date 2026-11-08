import { expect, it, vi } from "vitest";
import { createRealm, defineExtension, run } from "./core.js";
import { lint } from "./lint/index.js";

it.each([
  'return ["process","require","fetch","fs"].map(name => typeof globalThis[name]);',
  'return Function("return [typeof process,typeof require,typeof fetch,typeof fs]")();',
  'return ({}).constructor.constructor("return [typeof process,typeof require,typeof fetch,typeof fs]")();'
])("computed and dynamically compiled guest paths retain default denial: %s", async source => {
  expect(await run(source)).toMatchObject({
    ok: true, returnValue: ["undefined", "undefined", "undefined", "undefined"]
  });
});

it("lint permission does not grant runtime authority", async () => {
  const source = "return process;";
  expect(lint(source, { allowedGlobals: ["process"] })
    .filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  expect(await run(source)).toMatchObject({ ok: false });
  expect(await run("return typeof process;")).toMatchObject({ ok: true, returnValue: "undefined" });
});

it("completed checkpoint replay retains denials without repeating granted effects", async () => {
  const read = vi.fn(() => "grant");
  const modules = { storage: { read } };
  const source = 'import {read} from "storage"; return [read(),Function("return typeof process")(),typeof fetch];';
  const original = await run(source, { modules });
  expect(original).toMatchObject({ ok: true, returnValue: ["grant", "undefined", "undefined"] });
  const replay = await run(source, { modules, snapshot: original.snapshot });
  expect(replay).toMatchObject({ ok: true, returnValue: ["grant", "undefined", "undefined"] });
  expect(read).toHaveBeenCalledTimes(1);
});

it("capability labels alone grant no globals and cleanup remains once-only", async () => {
  const cleanup = vi.fn();
  const extension = defineExtension({
    manifest: { version: 1, name: "labels-only", capabilities: ["filesystem", "network", "process"] },
    setup(context) { context.onCleanup(cleanup); return {}; }
  });
  expect(() => createRealm({ extensions: [extension] }))
    .toThrow("Missing grant 'filesystem' for extension 'labels-only'.");
  expect(cleanup).not.toHaveBeenCalled();
  const realm = createRealm({
    extensions: [extension], grants: ["filesystem", "network", "process"]
  });
  try {
    expect(await realm.evaluate("return [typeof process,typeof require,typeof fetch,typeof fs];"))
      .toMatchObject({ ok: true, returnValue: ["undefined", "undefined", "undefined", "undefined"] });
  } finally { await realm.close(); await realm.close(); }
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("a grant in one realm cannot become ambient authority in another", async () => {
  const read = vi.fn(() => "explicit grant");
  const granted = createRealm({ modules: { storage: { read } } });
  const denied = createRealm();
  try {
    expect(await granted.evaluate('import {read} from "storage"; return [read(),typeof fs,typeof fetch];'))
      .toMatchObject({ ok: true, returnValue: ["explicit grant", "undefined", "undefined"] });
    expect(await denied.evaluate("return typeof fs;"))
      .toMatchObject({ ok: true, returnValue: "undefined" });
    await expect(denied.evaluate('import {read} from "storage"; return read();'))
      .rejects.toThrow("Unknown module 'storage'");
    expect(read).toHaveBeenCalledTimes(1);
    // Import failure poisons this realm; it cannot be reused to regain authority.
    await expect(denied.evaluate("return 1;"))
      .rejects.toThrow("Unknown module 'storage'");
  } finally { await granted.close(); await denied.close(); }
});

it("extension admission rejects accessor authority without invoking it", () => {
  const getter = vi.fn(() => ({ version: 1, name: "unexpected" }));
  const definition = Object.defineProperty({ setup: vi.fn() }, "manifest", { get: getter });
  expect(() => defineExtension(definition as never)).toThrow("not accessors");
  expect(getter).not.toHaveBeenCalled();
  expect(definition.setup).not.toHaveBeenCalled();
});
