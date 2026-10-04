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
