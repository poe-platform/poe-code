import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FsError, writeText } from "../../src/contracts/index.js";
import type { ByteSource } from "../../src/contracts/index.js";
import { ShellInput } from "../../src/shell/input.js";
import { Budget, defaultLimits, Runtime } from "../../src/shell/runtime.js";
import { setup } from "./helpers.js";

for (const scenario of ["cleanup-abort", "cleanup-late-rejection", "shared-delayed-generator", "shared-serialized", "shared-repeated-cancellation", "shared-abandoned-rejection", "shared-retained-rejection", "owned-cleanup-abort", "busy-loop-abort"]) {
  test(`hard-timeout lifecycle regression: ${scenario}`, () => {
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./lifecycle-probe.ts", import.meta.url)), scenario], {
      timeout: 3000, encoding: "utf8", maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined, `${scenario}: ${result.error?.message}`);
    assert.equal(result.signal, null, `${scenario}: child terminated by ${result.signal}`);
    assert.equal(result.status, 0, `${scenario}: ${result.stderr}`);
    assert.match(result.stdout, /: passed/u);
  });
}

test("write-only redirects never read and retain independent/duplicated offsets", async () => {
  for (const [script, expected] of [
    ["say replacement >file", "replacement\n"],
    ["both >file 2>file", "err\n"],
    ["both >file 2>&1", "out\nerr\n"],
    ["both >file 2>>file", "out\nerr\n"],
    ["say appended >>file", "oldappended\n"],
  ]) {
    const { shell, fs } = setup();
    await fs.writeFile("/file", new TextEncoder().encode("old"));
    await fs.chmod("/file", 0o200);
    let reads = 0;
    const readFile = fs.readFile.bind(fs);
    fs.readFile = async (...args) => { reads++; return readFile(...args); };
    const result = await shell.exec(script!);
    assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
    assert.equal(reads, 0, script);
    await fs.chmod("/file", 0o600);
    assert.equal(new TextDecoder().decode(await readFile("/file")), expected, script);
  }
});

test("offset and append descriptors interleave correctly without reading files", async () => {
  const { shell, fs, commands } = setup();
  commands.register({ name: "interleave", async execute({ stdout, stderr }) {
    await writeText(stdout, "abcdef");
    await writeText(stderr, "XY");
    await writeText(stdout, "!");
    await writeText(stderr, "Z");
    return { exitCode: 0 };
  } });
  await fs.writeFile("/file", new Uint8Array());
  await fs.chmod("/file", 0o200);
  for (const [script, expected] of [
    ["interleave >file 2>file", "XYZdef!"],
    ["interleave >file 2>>file", "abcdef!YZ"],
    ["interleave >>file 2>file", "XYZdef!"],
    ["interleave >file 2>&1", "abcdefXY!Z"],
    ["{ say first; say new >file; say last; } >file", "new\n\0\0last\n"],
  ]) {
    const result = await shell.exec(script!);
    assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
    await fs.chmod("/file", 0o600);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), expected, script);
    await fs.chmod("/file", 0o200);
  }
});

test("EOF redirects append only new bytes and expose each completed write", async () => {
  const { shell, fs, commands } = setup();
  const writes: number[] = [], appends: number[] = [];
  const write = fs.writeFile.bind(fs), append = fs.appendFile.bind(fs);
  fs.writeFile = async (path, bytes, options) => { writes.push(bytes.length); await write(path, bytes, options); };
  fs.appendFile = async (path, bytes, options) => { appends.push(bytes.length); await append(path, bytes, options); };
  commands.register({ name: "chunks", async execute({ stdout }) {
    for (let index = 0; index < 8; index++) {
      await writeText(stdout, "abc");
      assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "abc".repeat(index + 1));
    }
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec("chunks >file", { limits: { maxOutputBytes: 24 } })).exitCode, 0);
    assert.deepEqual(writes, [0]);
    assert.deepEqual(appends, Array(8).fill(3));
  } finally { await shell.dispose(); }
});

for (const mixed of [false, true]) test(`redirect retained storage grows geometrically: mixed append=${mixed}`, async context => {
  const { shell, commands } = setup();
  const buffers = new Set<ArrayBufferLike>();
  const fileOperation = Runtime.prototype.fileOperation;
  context.mock.method(Runtime.prototype, "fileOperation", async function (this: Runtime, ...args: Parameters<Runtime["fileOperation"]>) {
    await fileOperation.apply(this, args);
    const data = this.outputFiles.get(args[0])?.data;
    if (data?.length) buffers.add(data.buffer);
  });
  commands.register({ name: "chunks", async execute({ stdout, stderr }) {
    for (let index = 0; index < 64; index++) await writeText(mixed ? stderr : stdout, "abc");
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec(mixed ? "chunks >file 2>>file" : "chunks >file")).exitCode, 0);
    assert.ok(buffers.size > 0);
    assert.ok([...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0) <= 4 * 192);
  } finally { await shell.dispose(); }
});

for (const [replacement, expected] of [["Q", "abcXYZ"], ["123456789", "abcXYZ"], ["def", "defXYZ"]] as const) {
  test(`EOF redirect after direct VFS replacement preserves the declared mutation boundary: ${replacement}`, async () => {
    const { shell, fs, commands } = setup();
    commands.register({ name: "mutate", async execute({ stdout }) {
      await writeText(stdout, "abc");
      await fs.writeFile("/file", new TextEncoder().encode(replacement));
      await writeText(stdout, "XYZ");
      return { exitCode: 0 };
    } });
    try {
      assert.equal((await shell.exec("mutate >file")).exitCode, 0);
      assert.equal(new TextDecoder().decode(await fs.readFile("/file")), expected);
    } finally { await shell.dispose(); }
  });
}

test("EOF metadata failure falls back without reading a write-only file", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/file", new Uint8Array());
  await fs.chmod("/file", 0o200);
  const read = fs.readFile.bind(fs);
  fs.readFile = async () => { assert.fail("redirect must not read file contents"); };
  fs.stat = async () => { throw new FsError("EACCES"); };
  try {
    assert.equal((await shell.exec("{ say one; say two; } >file")).exitCode, 0);
    await fs.chmod("/file", 0o600);
    assert.equal(new TextDecoder().decode(await read("/file")), "one\ntwo\n");
  } finally { await shell.dispose(); }
});

for (const selected of [false, true]) for (const append of [false, undefined]) test(`EOF optimization requires declared append support: ${append}, path capabilities=${selected}`, async () => {
  const { shell, fs } = setup();
  const capabilities = { ...fs.capabilities, append };
  if (append === undefined) Reflect.deleteProperty(capabilities, "append");
  if (selected) Object.defineProperty(fs, "capabilitiesFor", { value: async () => capabilities });
  else Object.defineProperty(fs, "capabilities", { value: capabilities });
  let probes = 0;
  fs.appendFile = async () => { assert.fail("append is unsupported"); };
  fs.stat = async () => { probes++; throw new FsError("ENOTSUP"); };
  try {
    assert.equal((await shell.exec("{ say one; say two; } >file")).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "one\ntwo\n");
    assert.equal(probes, 0);
  } finally { await shell.dispose(); }
});

test("EOF optimization skips explicitly unavailable metadata", async () => {
  const { shell, fs } = setup();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, stat: false } });
  let probes = 0;
  fs.stat = async () => { probes++; throw new FsError("ENOTSUP"); };
  try {
    assert.equal((await shell.exec("{ say one; say two; } >file")).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "one\ntwo\n");
    assert.equal(probes, 0);
  } finally { await shell.dispose(); }
});

test("EOF metadata cancellation preserves the falsey caller reason before data writes", async () => {
  const { shell, fs } = setup();
  const controller = new AbortController();
  fs.stat = async () => { controller.abort(0); throw false; };
  try {
    await assert.rejects(shell.exec("say never >file", { signal: controller.signal }), error => Object.is(error, 0));
    assert.equal((await fs.readFile("/file")).length, 0);
  } finally { await shell.dispose(); }
});

test("empty redirect writes do not probe or mutate the backend", async () => {
  const { shell, fs, commands } = setup();
  let calls = 0;
  const stat = fs.stat.bind(fs), write = fs.writeFile.bind(fs), append = fs.appendFile.bind(fs);
  fs.stat = async (...args) => { calls++; return stat(...args); };
  fs.writeFile = async (...args) => { calls++; return write(...args); };
  fs.appendFile = async (...args) => { calls++; return append(...args); };
  commands.register({ name: "empty", async execute({ stdout }) {
    const before = calls;
    await stdout.write(new Uint8Array());
    assert.equal(calls, before);
    await writeText(stdout, "abc");
    await fs.writeFile("/file", new TextEncoder().encode("Q"));
    const replaced = calls;
    await stdout.write(new Uint8Array());
    assert.equal(calls, replaced);
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec("empty >file")).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "Q");
  } finally { await shell.dispose(); }
});

test("failed EOF appends do not publish pending bytes into another descriptor's mirror", async () => {
  const { shell, fs, commands } = setup();
  const append = fs.appendFile.bind(fs);
  let failures = 0;
  fs.appendFile = async (path, bytes, options) => {
    if (new TextDecoder().decode(bytes) === "cd") { failures++; throw false; }
    await append(path, bytes, options);
  };
  commands.register({ name: "failure", async execute({ stdout, stderr }) {
    await writeText(stdout, "ab");
    await assert.rejects(writeText(stdout, "cd"), error => Object.is(error, false));
    await writeText(stderr, "Z");
    return { exitCode: 1 };
  } });
  try {
    assert.equal((await shell.exec("failure >file 2>file")).exitCode, 1);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "Zb");
    assert.equal(failures, 1);
  } finally { await shell.dispose(); }
});

test("failed overlapping redirects preserve the retained bytes for a later EOF append", async () => {
  const { shell, fs, commands } = setup();
  const write = fs.writeFile.bind(fs);
  fs.writeFile = async (path, bytes, options) => {
    if (new TextDecoder().decode(bytes) === "cd") throw null;
    await write(path, bytes, options);
  };
  commands.register({ name: "failure", async execute({ stdout, stderr }) {
    await writeText(stdout, "ab");
    await assert.rejects(writeText(stderr, "cd"), error => Object.is(error, null));
    await writeText(stdout, "E");
    return { exitCode: 1 };
  } });
  try {
    assert.equal((await shell.exec("failure >file 2>file")).exitCode, 1);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "abE");
  } finally { await shell.dispose(); }
});

test("cancelled queued readers cannot bypass an active shared read", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let maximum = 0;
  let position = 0;
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      active++;
      maximum = Math.max(maximum, active);
      const index = position++;
      try { if (index === 0) await gate; return { value: new Uint8Array([65 + index]), done: false }; }
      finally { active--; }
    },
    async return() { returned++; return { value: undefined, done: true }; },
  }; } };
  const budget = new Budget(defaultLimits);
  const owner = new ShellInput(source, budget);
  const controller = new AbortController();
  const first = new ShellInput(owner, budget);
  const cancelled = new ShellInput(owner, budget, controller.signal);
  const third = new ShellInput(owner, budget);
  const firstRead = first.next();
  const secondRead = cancelled.next();
  const thirdRead = third.next();
  controller.abort(new Error("cancel queued read"));
  await assert.rejects(secondRead, /cancel queued read/u);
  await cancelled.close();
  assert.equal(returned, 0);
  release();
  assert.deepEqual([...(await firstRead).value!], [65]);
  assert.deepEqual([...(await thirdRead).value!], [66]);
  assert.equal(maximum, 1);
  await first.close();
  await third.close();
  assert.equal(returned, 0);
  await owner.close();
  assert.equal(returned, 1);
});

test("input errors still close their owned iterator exactly once", async () => {
  const { shell } = setup();
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw new Error("read failed"); },
    async return() { returned++; return { value: undefined, done: true }; },
  }; } };
  const result = await shell.exec("pass", { stdin });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /read failed/u);
  assert.equal(returned, 1);
});
