import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { TextStore } from "./stored-text.js";

async function fixture(run: (text: TextStore, fs: MemoryFileSystem) => Promise<void>) {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal: new AbortController().signal }, 2);
  try { await run(new TextStore(storage), fs); }
  finally { await storage.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
}
async function collect(text: TextStore, root: number): Promise<string> {
  let output = "";
  for await (const chunk of text.chunks(root)) output += chunk;
  return output;
}

test("stored text concatenation and slicing preserve Unicode and immutable inputs", () => fixture(async text => {
  const a = await text.from("a😀é"), b = await text.from("\r\nb");
  const joined = await text.concat(a, b);
  assert.equal(await collect(text, joined), "a😀é\r\nb");
  assert.equal(await collect(text, a), "a😀é");
  assert.equal(await collect(text, await text.slice(joined, 1, 4)), "😀é");
  assert.equal((await text.info(joined)).length, 7);
  assert.equal((await text.info(joined)).bytes, 10);
  for (let index = 0; index < 7; index++) assert.equal(await text.at(joined, index), "a😀é\r\nb"[index]);
}));

test("repeated concatenation stays balanced and shares large operands", () => fixture(async text => {
  const unit = await text.from("ab");
  let left = 0, right = 0;
  for (let index = 0; index < 1000; index++) {
    left = await text.concat(left, unit);
    right = await text.concat(unit, right);
  }
  assert.equal(await collect(text, left), "ab".repeat(1000));
  assert.equal(await collect(text, right), "ab".repeat(1000));
  assert.ok((await text.info(left)).height < 20);
  assert.ok((await text.info(right)).height < 20);
  const doubled = await text.repeat(left, 100);
  assert.equal((await text.info(doubled)).length, 200000);
  assert.equal(await collect(text, await text.slice(doubled, 199990, 200000)), "ababababab");
}));

test("spilled output uses bounded retained I/O and awaits its sink", () => fixture(async (text, fs) => {
  let opened = 0, maximumRead = 0, maximumWrite = 0, closed = 0;
  const open = fs.open.bind(fs);
  fs.open = async (path, options) => {
    opened++;
    const fd = await open(path, options);
    return { ...fd, capabilities: fd.capabilities, stat: fd.stat.bind(fd), truncate: fd.truncate.bind(fd), sync: fd.sync.bind(fd),
      async read(bytes, position, options) { maximumRead = Math.max(maximumRead, bytes.length); return fd.read(bytes, position, options); },
      async write(bytes, position, options) { maximumWrite = Math.max(maximumWrite, bytes.length); return fd.write(bytes, position, options); },
      async close(options) { closed++; return fd.close(options); },
    };
  };
  fs.readFile = async () => { throw new Error("whole-file read forbidden"); };
  fs.writeFile = async () => { throw new Error("whole-file write forbidden"); };
  const builder = text.builder();
  const chunk = "z".repeat(4096);
  for (let index = 0; index < 32; index++) await builder.write(chunk);
  const root = await builder.finish();
  let entered!: () => void, release!: () => void, writes = 0, bytes = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = text.write(root, { async write(chunk) {
    writes++; assert.ok(chunk.length <= 8192); bytes += chunk.length;
    if (writes === 1) { entered(); await gate; }
  } });
  await waiting;
  assert.equal(writes, 1);
  release(); await pending;
  assert.equal(bytes, 131072); assert.equal(opened, 1); assert.equal(closed, 0);
  assert.ok(maximumRead <= 16384); assert.ok(maximumWrite <= 16384);
}));

test("text transformations span storage chunk boundaries", () => fixture(async text => {
  const root = await text.concat(await text.from(" \r"), await text.from("\n a  b \t"));
  assert.equal(await collect(text, await text.trim(root)), "a  b");
  assert.equal(await collect(text, await text.normalize(root, "space")), " a b ");
  assert.equal(await collect(text, await text.normalize(root, "lines")), " \n a  b \t");
  assert.equal(await text.includes(root, "a  b"), true);
  assert.equal(await text.includes(root, "absent"), false);
}));

test("a rejected writer prevents further output", () => fixture(async text => {
  const root = await text.from("x".repeat(10000));
  const reason = new Error("writer failed"); let writes = 0;
  await assert.rejects(text.write(root, { write() { writes++; throw reason; } }), error => error === reason);
  assert.equal(writes, 1);
}));

test("stored text preserves BOM characters at every leaf boundary", async () => fixture(async text => {
  const value = "\ufeffx" + "a".repeat(2046) + "\ufeffy";
  const root = await text.from(value);
  let actual = "";
  for await (const chunk of text.chunks(root)) actual += chunk;
  assert.equal(actual.length, value.length);
  assert.equal(actual, value);
  assert.equal(await text.at(root, 0), "\ufeff");
  assert.equal(await text.at(root, 2048), "\ufeff");
}));

test("stored scalar offsets distinguish UTF-16 width across rope leaves", () => fixture(async text => {
  const value = "a😀𐀀é".repeat(1024), root = await text.from(value);
  assert.equal((await text.info(root)).points, 4096);
  for (const index of [0, 1, 2, 3, 4, 2047, 2048, 4095, 4096]) {
    assert.equal(await text.pointOffset(root, index), [...value].slice(0, index).join("").length);
  }
}));

test("incremental text construction writes linear rope metadata", async () => {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal: new AbortController().signal }, 2);
  let records = 0;
  const text = new TextStore({
    read: storage.read.bind(storage),
    append(bytes) { if (bytes.length === 56) records++; return storage.append(bytes); }
  });
  try {
    const builder = text.builder(), chunk = "x".repeat(2048);
    for (let i = 0; i < 512; i++) await builder.write(chunk);
    const root = await builder.finish();
    assert.equal((await text.info(root)).length, 512 * chunk.length);
    assert.ok(records <= 512 * 3, `Repeated spine copying: ${records} records`);
    let bytes = 0;
    await text.write(root, { async write(value) { assert.ok(value.every(byte => byte === 120)); bytes += value.length; } });
    assert.equal(bytes, 512 * chunk.length);
  } finally { await storage.close(); }
});

test("builder snapshots stay immutable across mixed rope and Unicode appends", () => fixture(async text => {
  const builder = text.builder();
  let expected = "";
  const snapshots: [number, string][] = [];
  for (let i = 0; i < 20; i++) {
    const value = (i % 2 ? "😀" : "é").repeat(i * 127 + 1);
    if (i % 3) await builder.write(value);
    else await builder.append(await text.from(value));
    expected += value;
    if (i % 4 === 0) snapshots.push([await builder.finish(), expected]);
  }
  assert.equal(await collect(text, await builder.finish()), expected);
  for (const [root, value] of snapshots) assert.equal(await collect(text, root), value);
}));

test("repeated short text reuses backed records without repeated metadata I/O", async () => {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal: new AbortController().signal }, 2);
  let reads = 0, appends = 0, checkpoints = 0;
  const text = new TextStore({
    async append(bytes) { appends++; return storage.append(bytes); },
    async read(offset, length) { reads++; return storage.read(offset, length); }
  }, () => { checkpoints++; });
  try {
    for (let i = 0; i < 100; i++) {
      const root = await text.from("p");
      assert.equal((await text.info(root)).length, 1);
      assert.equal(await collect(text, root), "p");
    }
    assert.ok(appends <= 2, `Repeated immutable text allocated ${appends} records`);
    assert.ok(reads <= 100, `Repeated metadata caused ${reads} storage reads`);
    assert.equal(checkpoints, 200, "Cache hits must still cooperate");
  } finally { await storage.close(); }
});

test("short-text cache evicts old entries and never interns large payloads", () => fixture(async text => {
  const original = await text.from("old");
  for (let i = 0; i < 1024; i++) await text.from(`name-${i}`);
  assert.notEqual(await text.from("old"), original);
  assert.equal(await collect(text, original), "old");
  const large = "x".repeat(2048);
  assert.notEqual(await text.from(large), await text.from(large));
}));

test("metadata eviction reloads immutable records and cached text preserves cancellation", async () => {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal: new AbortController().signal }, 2);
  let reads = 0;
  const controller = new AbortController();
  const text = new TextStore({
    append: storage.append.bind(storage),
    async read(offset, length) { reads++; return storage.read(offset, length); }
  }, () => controller.signal.throwIfAborted());
  try {
    const root = await text.from("first");
    for (let i = 0; i < 1024; i++) await text.from(`value-${i}`);
    const before = reads;
    assert.equal((await text.info(root)).length, 5);
    assert.equal(reads, before + 1, "Old metadata must be evicted and reloaded");
    assert.equal(await collect(text, root), "first");
    await text.from("cached");
    const reason = new Error("cancelled");
    controller.abort(reason);
    await assert.rejects(text.from("cached"), error => error === reason);
  } finally { await storage.close(); }
});
