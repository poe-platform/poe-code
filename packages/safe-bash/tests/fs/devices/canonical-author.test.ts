import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, createMemoryFileSystem, createMountFileSystem, toByteSource } from "poe-code/safe-fs";
import { ddCommands } from "../../../src/commands/dd/index.js";
import { createDeviceFileSystem } from "../../../src/fs/devices/index.js";
import { Shell } from "../../../src/shell/index.js";

for (const size of [0, 3]) test(`Darwin urandom explicit buffered writes reject EPERM for ${size} bytes`, async () => {
  const fs = createDeviceFileSystem();
  const bytes = new Uint8Array(size);
  await assert.rejects(fs.writeFile("/urandom", bytes), { code: "EPERM", syscall: "writeFile" });
  await assert.rejects(fs.writeFile("/urandom", bytes, { flag: "a" }), { code: "EPERM" });
  await assert.rejects(fs.appendFile("/urandom", bytes), { code: "EPERM", syscall: "appendFile" });
  await assert.rejects(fs.writeFile("/urandom", bytes, { flag: "wx" }), { code: "EEXIST" });
});

test("Darwin urandom write stream distinguishes no write from explicit empty descriptor writes", async () => {
  const fs = createDeviceFileSystem();
  await fs.writeStream("/urandom", toByteSource(new Uint8Array()));
  await fs.writeStream("/urandom", (async function* () { yield new Uint8Array(); yield new Uint8Array(); })());
  await fs.copyFile("/null", "/urandom");
  const writer = await fs.open!("/urandom", { access: "write", truncate: true });
  try { await assert.rejects(writer.write(new Uint8Array(), null), { code: "EPERM" }); }
  finally { await writer.close(); }
});

test("Darwin urandom nonempty stream refusal retires producer before another pull", async () => {
  const fs = createDeviceFileSystem();
  let pulls = 0;
  let closes = 0;
  async function* source() {
    try {
      pulls++;
      yield new Uint8Array();
      pulls++;
      yield Uint8Array.of(4);
      pulls++;
      yield Uint8Array.of(5);
    } finally { closes++; }
  }
  await assert.rejects(fs.writeStream("/urandom", source()), { code: "EPERM" });
  assert.equal(pulls, 2);
  assert.equal(closes, 1);
});

for (const name of ["null", "zero", "random"]) test(`Darwin ${name} discards bounded streamed payloads and explicit empty writes`, async () => {
  const fs = createDeviceFileSystem();
  const before = await fs.stat(`/${name}`);
  const bytes = new Uint8Array(65536).fill(7);
  let pulls = 0;
  await fs.writeStream(`/${name}`, (async function* () {
    for (let index = 0; index < 16; index++) { pulls++; yield bytes; }
  })());
  assert.equal(pulls, 16);
  await fs.writeFile(`/${name}`, new Uint8Array());
  await fs.appendFile(`/${name}`, bytes);
  assert.deepEqual(await fs.stat(`/${name}`), before);
  assert.equal(fs.capabilities.randomAccessWrite, false);
});

test("canonical full demand reads use bounded crypto calls and shared sequential cursor serialization", async context => {
  const fs = createDeviceFileSystem();
  const calls: number[] = [];
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    calls.push(bytes.length);
    bytes.fill(calls.length);
    return bytes;
  });
  const descriptor = await fs.open!("/random", { access: "read" });
  context.after(() => descriptor.close());
  const first = new Uint8Array(131073).fill(0xa5);
  const second = new Uint8Array(2);
  assert.deepEqual(await Promise.all([descriptor.read(first, null), descriptor.read(second, null)]), [131073, 2]);
  assert.deepEqual(calls, [65536, 65536, 1, 2]);
  assert.equal(await descriptor.getPosition!(), 131075);
  assert.deepEqual(first.subarray(0, 65536), new Uint8Array(65536).fill(1));
  assert.deepEqual(first.subarray(65536, 131072), new Uint8Array(65536).fill(2));
  assert.equal(first[131072], 3);
  assert.deepEqual(second, Uint8Array.of(4, 4));
  assert.equal(await descriptor.read(new Uint8Array(), null), 0);
  await descriptor.probeRead!();
  assert.deepEqual(calls, [65536, 65536, 1, 2]);
});

for (const reason of [false, 0]) test(`canonical random provider cancellation ${reason} outranks failure without cursor advancement`, async context => {
  const fs = createDeviceFileSystem();
  const controller = new AbortController();
  context.mock.method(globalThis.crypto, "getRandomValues", () => {
    controller.abort(reason);
    throw new Error("secondary entropy failure");
  });
  const descriptor = await fs.open!("/random", { access: "read" });
  context.after(() => descriptor.close());
  await assert.rejects(descriptor.read(new Uint8Array(1), null, { signal: controller.signal }), error => Object.is(error, reason));
  assert.equal(await descriptor.getPosition!(), 0);
});

test("canonical positioned reads do not consume stream windows or grow storage", async () => {
  const fs = createDeviceFileSystem();
  const descriptor = await fs.open!("/zero", { access: "readwrite", append: true });
  try {
    assert.equal(await descriptor.read(new Uint8Array(2), Number.MAX_SAFE_INTEGER), 2);
    assert.equal(await descriptor.write(Uint8Array.of(1), Number.MAX_SAFE_INTEGER), 1);
    assert.equal(await descriptor.getPosition!(), 0);
    assert.equal((await descriptor.stat()).size, 0);
    assert.deepEqual(await collectBytes(fs.readStream("/zero", { start: 7, endExclusive: 12 }), { maxBytes: 5 }), new Uint8Array(5));
  } finally { await descriptor.close(); }
});

test("canonical random reads stage owned bytes before publishing into a shared caller buffer", async context => {
  const fs = createDeviceFileSystem();
  const descriptor = await fs.open!("/urandom", { access: "read" });
  context.after(() => descriptor.close());
  const bytes = new Uint8Array(new SharedArrayBuffer(9)).fill(0xa5);
  let fail = true;
  const failure = new Error("entropy failure after touching the provider buffer");
  context.mock.method(globalThis.crypto, "getRandomValues", (target: Uint8Array) => {
    assert.ok(target.buffer instanceof ArrayBuffer);
    assert.equal(target.length, 5);
    target.fill(7);
    if (fail) throw failure;
    return target;
  });
  await assert.rejects(descriptor.read(bytes.subarray(2, 7), null), error => {
    assert.equal((error as Error).cause, failure);
    return true;
  });
  assert.deepEqual(bytes, new Uint8Array(9).fill(0xa5));
  assert.equal(await descriptor.getPosition!(), 0);
  fail = false;
  assert.equal(await descriptor.read(bytes.subarray(2, 7), null), 5);
  assert.deepEqual(bytes, Uint8Array.of(0xa5, 0xa5, 7, 7, 7, 7, 7, 0xa5, 0xa5));
});

for (const name of ["null", "zero", "random", "urandom"] as const) {
  for (const request of [{ size: 65536, position: null }, { size: 65537, position: null },
    { size: 262144, position: null }, { size: 65537, position: 3 }]) {
    test(`captured Darwin full descriptor read ${name} size=${request.size} position=${request.position}`, async context => {
      const calls: number[] = [];
      context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
        calls.push(bytes.length);
        bytes.fill(0x42);
        return bytes;
      });
      const descriptor = await createDeviceFileSystem().open(`/${name}`, { access: "readwrite" });
      context.after(() => descriptor.close());
      if (name === "null") await descriptor.write(new Uint8Array(7), null);
      else await descriptor.read(new Uint8Array(7), null);
      assert.equal(await descriptor.getPosition!(), 7);
      calls.length = 0;
      const storage = new Uint8Array(request.size + 4).fill(0xa5);
      const count = await descriptor.read(storage.subarray(2, -2), request.position);
      assert.equal(count, name === "null" ? 0 : request.size);
      assert.equal(await descriptor.getPosition!(), name === "null" || request.position !== null ? 7 : 7 + request.size);
      assert.deepEqual(storage.subarray(0, 2), Uint8Array.of(0xa5, 0xa5));
      assert.deepEqual(storage.subarray(-2), Uint8Array.of(0xa5, 0xa5));
      assert.deepEqual(storage.subarray(2, -2), new Uint8Array(request.size).fill(name === "null" ? 0xa5 : name === "zero" ? 0 : 0x42));
      if (name === "random" || name === "urandom") {
        assert.equal(calls.reduce((total, length) => total + length, 0), request.size);
        assert.ok(calls.every(length => length > 0 && length <= 65536));
      } else assert.deepEqual(calls, []);
    });
  }
}

for (const position of [null, 3]) test(`later crypto failure keeps only published prefix and its cursor position=${position}`, async context => {
  let calls = 0;
  const failure = new Error("second crypto chunk failed");
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    bytes.fill(9);
    if (++calls === 2) throw failure;
    return bytes;
  });
  const descriptor = await createDeviceFileSystem().open("/random", { access: "read" });
  context.after(() => descriptor.close());
  const bytes = new Uint8Array(131073).fill(0xa5);
  await assert.rejects(descriptor.read(bytes, position), error => {
    assert.equal((error as Error).cause, failure);
    return true;
  });
  assert.equal(calls, 2);
  assert.deepEqual(bytes.subarray(0, 65536), new Uint8Array(65536).fill(9));
  assert.deepEqual(bytes.subarray(65536), new Uint8Array(bytes.length - 65536).fill(0xa5));
  assert.equal(await descriptor.getPosition!(), position === null ? 65536 : 0);
});

for (const reason of [false, 0]) test(`between-chunk cancellation ${reason} drains close and preserves committed prefix`, async context => {
  const controller = new AbortController();
  let calls = 0;
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    calls++;
    bytes.fill(7);
    queueMicrotask(() => controller.abort(reason));
    return bytes;
  });
  const descriptor = await createDeviceFileSystem().open("/random", { access: "read" });
  context.after(() => descriptor.close());
  const bytes = new Uint8Array(131073).fill(0xa5);
  const reading = descriptor.read(bytes, null, { signal: controller.signal });
  const rejected = assert.rejects(reading, error => Object.is(error, reason));
  await rejected;
  assert.equal(calls, 1);
  assert.equal(await descriptor.getPosition!(), 65536);
  assert.deepEqual(bytes.subarray(0, 65536), new Uint8Array(65536).fill(7));
  assert.deepEqual(bytes.subarray(65536), new Uint8Array(bytes.length - 65536).fill(0xa5));
  await descriptor.close();
  await assert.rejects(descriptor.read(new Uint8Array(1), null), { code: "EBADF" });
});

for (const name of ["zero", "random"]) test(`concurrent close drains admitted large ${name} read after cancellation`, async context => {
  const controller = new AbortController();
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => { bytes.fill(7); return bytes; });
  const descriptor = await createDeviceFileSystem().open(`/${name}`, { access: "read" });
  context.after(() => descriptor.close());
  const bytes = new Uint8Array(262144).fill(0xa5);
  let closed = false;
  const reading = descriptor.read(bytes, null, { signal: controller.signal });
  const rejected = assert.rejects(reading, error => Object.is(error, false));
  const closing = descriptor.close().then(() => { closed = true; });
  queueMicrotask(() => { assert.equal(closed, false); controller.abort(false); });
  await rejected;
  await closing;
  assert.equal(closed, true);
  assert.deepEqual(bytes.subarray(0, 65536), new Uint8Array(65536).fill(name === "zero" ? 0 : 7));
  assert.deepEqual(bytes.subarray(65536), new Uint8Array(bytes.length - 65536).fill(0xa5));
  await assert.rejects(descriptor.getPosition!(), { code: "EBADF" });
});

for (const name of ["zero", "random", "urandom"]) for (const size of [65537, 262144]) {
  test(`source Shell dd copies one full ${size}-byte ${name} block and reports one complete record`, async context => {
    const root = createMemoryFileSystem();
    const fs = createMountFileSystem({ root, mounts: { "/dev": createDeviceFileSystem() } });
    const shell = new Shell({ fs, limits: { maxWallClockMs: 2000, maxOutputBytes: 1048576 } }).use(ddCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`dd if=/dev/${name} of=/output bs=${size} count=1 status=none`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdoutBytes.length, 0);
    assert.equal(result.stderrBytes.length, 0);
    const bytes = await root.readFile("/output");
    assert.equal(bytes.length, size);
    if (name === "zero") assert.deepEqual(bytes, new Uint8Array(size));
    const records = await shell.exec(`dd if=/dev/${name} of=/output bs=${size} count=1 status=noxfer`);
    assert.equal(records.exitCode, 0, records.stderr);
    assert.equal(records.stderr, "1+0 records in\n1+0 records out\n");
    assert.equal((await root.stat("/output")).size, size);
  });
}
