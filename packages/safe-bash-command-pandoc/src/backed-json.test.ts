import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {ExecutionContext} from "./execution.js";

it("serializes spilled nested values and streamed strings with exact JSON escaping", async () => {
  const fs = new MemoryFileSystem();
  const context = new ExecutionContext("convert", {});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const tree = new BackedJson(storage, units => context.cooperate(units));
  const string = 'a'.repeat(4095) + '😀\n\u0000"\\\ud800x\udc00' + "é".repeat(20000);
  try {
    await tree.begin("object");
    await tree.key("payload");
    await tree.begin("string");
    for (let offset = 0; offset < string.length; offset += 113) await tree.text(string.slice(offset, offset + 113));
    await tree.end();
    await tree.key("nested");
    await tree.value([null, true, false, -2.5, [], {}, {a: [1, "x"]}]);
    await tree.end();
    let output = "";
    for await (const bytes of tree.chunks()) {
      expect(bytes.length).toBeLessThanOrEqual(16384);
      output += new TextDecoder().decode(bytes);
    }
    expect(output).toBe(JSON.stringify({payload: string, nested: [null, true, false, -2.5, [], {}, {a: [1, "x"]}]}));
    let again = "";
    for await (const bytes of tree.chunks()) again += new TextDecoder().decode(bytes);
    expect(again).toBe(output);
  } finally {await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("constructs and traverses deep trees without retaining a traversal stack", async () => {
  const fs = new MemoryFileSystem();
  const context = new ExecutionContext("convert", {});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const tree = new BackedJson(storage, units => context.cooperate(units));
  try {
    for (let index = 0; index < 1200; index++) await tree.begin("array");
    await tree.value("leaf");
    for (let index = 0; index < 1200; index++) await tree.end();
    let output = "";
    for await (const bytes of tree.chunks()) output += new TextDecoder().decode(bytes);
    expect(output).toBe("[".repeat(1200) + '"leaf"' + "]".repeat(1200));
  } finally {await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("observes timer cancellation while serializing a long stored string", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const context = new ExecutionContext("convert", {signal: controller.signal});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: controller.signal}, 1);
  const tree = new BackedJson(storage, units => context.cooperate(units));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await tree.value("x".repeat(100000));
    timer = setTimeout(() => controller.abort(), 0);
    let emitted = 0;
    await expect((async () => {
      for await (const bytes of tree.chunks()) emitted += bytes.length;
    })()).rejects.toMatchObject({code: "E_CANCELLED"});
    expect(emitted).toBeLessThan(100000);
  } finally {
    clearTimeout(timer);
    await storage.close(); await context.close();
  }
  expect(await fs.readdir("/")).toEqual([]);
});
