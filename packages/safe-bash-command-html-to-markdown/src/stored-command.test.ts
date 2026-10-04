import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { convert } from "./fixtures.js";

test("command stores large text in the injected filesystem and writes bounded output", async () => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs);
  let opened = 0, closed = 0, writeSize = 0, outputSize = 0, calls = 0;
  fs.open = async (path, options) => {
    opened++;
    const descriptor = await open(path, options);
    return { ...descriptor, capabilities: descriptor.capabilities,
      stat: descriptor.stat.bind(descriptor), truncate: descriptor.truncate.bind(descriptor), sync: descriptor.sync.bind(descriptor), read: descriptor.read.bind(descriptor),
      async write(bytes, position, options) { writeSize = Math.max(writeSize, bytes.length); return descriptor.write(bytes, position, options); },
      async close(options) { closed++; return descriptor.close(options); },
    };
  };
  fs.readFile = async () => { throw new Error("payload readFile forbidden"); };
  fs.writeFile = async () => { throw new Error("payload writeFile forbidden"); };
  const chunk = new TextEncoder().encode("x".repeat(4096));
  const source = { async *[Symbol.asyncIterator]() {
    yield new TextEncoder().encode("<p>");
    for (let index = 0; index < 32; index++) yield chunk;
    yield new TextEncoder().encode("</p>");
  } };
  const result = await convert(source, {}, { fs, stdout: { async write(bytes) {
    calls++; outputSize += bytes.length; assert.ok(bytes.length <= 8192);
    for (const byte of bytes) assert.ok(byte === 120 || byte === 10);
    await Promise.resolve();
  } } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(outputSize, 131073); assert.ok(calls > 1);
  assert.ok(opened > 0, "command must spill instead of retaining the whole document");
  assert.equal(closed, opened); assert.ok(writeSize <= 16384);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const outcome of ["failure", "abort"] as const) test(`spilling ${outcome} preserves the primary reason and releases backing`, async () => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
  const reason = new Error("backing interrupted");
  let closed = 0, observed: unknown;
  fs.open = async (path, options) => {
    const fd = await open(path, options);
    return { ...fd, capabilities: fd.capabilities, stat: fd.stat.bind(fd), read: fd.read.bind(fd), truncate: fd.truncate.bind(fd), sync: fd.sync.bind(fd),
      async write() { if (outcome === "abort") controller.abort(reason); throw reason; },
      async close(options) { closed++; return fd.close(options); },
    };
  };
  const chunk = new TextEncoder().encode("x".repeat(4096));
  const source = { async *[Symbol.asyncIterator]() { for (let index = 0; index < 32; index++) yield chunk; } };
  const invocation = convert(source, {}, { fs, signal: controller.signal, onInternalError(error) { observed = error; } });
  if (outcome === "abort") await assert.rejects(invocation, error => error === reason);
  else {
    const result = await invocation;
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.equal(observed, reason);
  }
  assert.equal(closed, 1); assert.deepEqual(await fs.readdir("/"), []);
});

test("command spills an unfinished attribute before reading its closing bytes", async () => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs);
  let opened = 0;
  fs.open = async (path, options) => { opened++; return open(path, options); };
  const chunk = new TextEncoder().encode("x".repeat(4096));
  const source = { async *[Symbol.asyncIterator]() {
    yield new TextEncoder().encode('<p title="');
    for (let index = 0; index < 64; index++) yield chunk;
    assert.ok(opened > 0, "unfinished attributes must already be in caller backing");
    yield new TextEncoder().encode('">ok</p>');
  } };
  const result = await convert(source, {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "ok\n");
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const outcome of ["failure", "abort"] as const) test(`renderer continuation spill ${outcome} cleans up and preserves the primary reason`, async () => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
  const reason = new Error("render backing interrupted");
  let parsed = false, closed = 0, observed: unknown;
  fs.open = async (path, options) => {
    const fd = await open(path, options);
    return { ...fd, capabilities: fd.capabilities, stat: fd.stat.bind(fd), read: fd.read.bind(fd), truncate: fd.truncate.bind(fd), sync: fd.sync.bind(fd),
      async write(bytes, position, options) {
        if (parsed) { if (outcome === "abort") controller.abort(reason); throw reason; }
        return fd.write(bytes, position, options);
      },
      async close(options) { closed++; return fd.close(options); },
    };
  };
  const encoder = new TextEncoder(), opening = encoder.encode("<div>"), closing = encoder.encode("</div>");
  const source = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 256; index++) yield opening;
    yield encoder.encode("ok");
    for (let index = 0; index < 256; index++) yield closing;
    parsed = true;
  } };
  const invocation = convert(source, {}, { fs, signal: controller.signal, onInternalError(error) { observed = error; } });
  if (outcome === "abort") await assert.rejects(invocation, error => error === reason);
  else {
    const result = await invocation;
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.equal(observed, reason);
  }
  assert.equal(parsed, true); assert.equal(closed, 1); assert.deepEqual(await fs.readdir("/"), []);
});
