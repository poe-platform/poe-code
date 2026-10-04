import {expect, it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {BackedJson, parseBackedJson} from "./index.js";
import {indexJsonObjects} from "./object-order.js";

async function fixture(input: string, run: (tree: BackedJson, scratch: PagedStorage, cooperate: () => Promise<void>) => Promise<void>) {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const context = {fs, cwd: "/scratch", env: {}, signal: new AbortController().signal};
  const storage = new PagedStorage(context, 1), scratch = new PagedStorage(context, 1);
  const cooperate = async () => {context.signal.throwIfAborted();};
  const tree = new BackedJson(storage, cooperate);
  try {
    await parseBackedJson((async function* () {for (let at = 0; at < input.length; at += 17) yield input.slice(at, at + 17);})(), tree, scratch, cooperate, (_at, message) => {throw new Error(message);}, undefined, true);
    await run(tree, scratch, cooperate);
  } finally {await storage.close(); await scratch.close();}
  expect(await fs.readdir("/scratch")).toEqual([]);
}

it("replays JSON.parse property order and last values without changing the source tape", async () => {
  const input = '{"z":0,"10":10,"2":2,"01":1,"z":{"b":1,"a":2,"b":[3,{"x":0,"x":4}]},"0":0,"4294967295":5,"4294967294":4,"__proto__":1,"__proto__":2,"constructor":3,"":0,"":1}';
  await fixture(input, async (tree, scratch, cooperate) => {
    const order = await indexJsonObjects(tree, scratch, cooperate);
    const chunks = []; for await (const chunk of tree.chunks(tree.rootPosition, order)) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe(JSON.stringify(JSON.parse(input)));
    const entries = []; for await (const entry of order.entries(tree.rootPosition)) entries.push([await tree.smallText(entry.key, 100), await tree.smallText(entry.value, 100)]);
    expect(entries.map(entry => entry[0])).toEqual(Object.keys(JSON.parse(input)));
    expect(await tree.smallText((await tree.property(tree.rootPosition, "z"))!, 10)).toBe("0");
    expect((await tree.describe((await order.property(tree.rootPosition, "z"))!)).kind).toBe("object");
    expect(await order.property(tree.rootPosition, "absent")).toBeUndefined();
  });
});

it("handles long keys, lone surrogates, hash collisions and wide objects in caller storage", async () => {
  // Both ASCII strings have the same 32-bit FNV-style hash used by the index.
  const keys = ["key-31ot-3682751805", "key-345l-404067065", "key".repeat(6000), "\ud800", "", ...Array.from({length: 600}, (_, i) => String(600 - i))];
  const input = `{${keys.map((key, i) => `${JSON.stringify(key)}:${i}`).join(",")},${keys.map((key, i) => `${JSON.stringify(key)}:${-i}`).join(",")}}`;
  await fixture(input, async (tree, scratch, cooperate) => {
    const order = await indexJsonObjects(tree, scratch, cooperate);
    const chunks = []; for await (const chunk of tree.chunks(tree.rootPosition, order)) {expect(chunk.length).toBeLessThanOrEqual(16384); chunks.push(chunk);}
    expect(Buffer.concat(chunks).toString()).toBe(JSON.stringify(JSON.parse(input)));
  });
});

it("keeps empty containers and primitive roots intact", async () => {
  for (const input of ['{}', '[]', '[{},[],{"a":{},"a":[]}]', 'null', '1e400', '-0', '9007199254740993']) {
    await fixture(input, async (tree, scratch, cooperate) => {
      const order = await indexJsonObjects(tree, scratch, cooperate);
      const chunks = []; for await (const chunk of tree.chunks(tree.rootPosition, order)) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe(JSON.stringify(JSON.parse(input)));
    });
  }
});

it("cooperates during indexing and propagates cancellation without owning storage", async () => {
  await fixture('{"a":1,"b":2}', async (tree, scratch) => {
    const reason = new Error("cancel index"); let calls = 0;
    await expect(indexJsonObjects(tree, scratch, async () => {if (++calls === 4) throw reason;})).rejects.toBe(reason);
    expect(await tree.smallText((await tree.property(tree.rootPosition, "a"))!, 10)).toBe("1");
  });
});

it("propagates caller backing failure and can rebuild from the unchanged tape", async () => {
  await fixture('{"a":1,"b":2,"a":3}', async (tree, scratch, cooperate) => {
    const reason = new Error("backing write failed"); let writes = 0;
    const broken = new Proxy(scratch, {get(target, property) {
      if (property === "write") return async (at: number, bytes: Uint8Array) => {if (++writes === 4) throw reason; await target.write(at, bytes);};
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    }});
    await expect(indexJsonObjects(tree, broken, cooperate)).rejects.toBe(reason);
    const order = await indexJsonObjects(tree, scratch, cooperate);
    expect(await tree.smallText((await order.property(tree.rootPosition, "a"))!, 10)).toBe("3");
  });
});

it("checks cancellation while reading the completed index", async () => {
  await fixture('{"a":1,"b":2}', async (tree, scratch) => {
    const reason = new Error("stop traversal"); let stopped = false;
    const order = await indexJsonObjects(tree, scratch, async () => {if (stopped) throw reason;});
    const reader = order.entries(tree.rootPosition);
    expect((await reader.next()).done).toBe(false);
    stopped = true;
    await expect(reader.next()).rejects.toBe(reason);
    await expect(order.property(tree.rootPosition, "b")).rejects.toBe(reason);
  });
});
