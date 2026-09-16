import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createMemoryFileSystem, FsError, type FileSystem } from "poe-code/safe-fs";
import { agentCommands } from "../../../../src/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";

function override<Value extends object>(target: Value, replacements: { [Key in keyof Value]?: Value[Key] | undefined }): Value {
  return new Proxy(target, { get(object, key) {
    if (Object.hasOwn(replacements, key)) return Reflect.get(replacements, key);
    const member: unknown = Reflect.get(object, key, object);
    return typeof member === "function" ? member.bind(object) : member;
  } });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function setup(fs: FileSystem = createMemoryFileSystem()) {
  const internalErrors: unknown[] = [];
  const shell = new Shell({ fs, env: { LC_ALL: "C" }, onInternalError: error => { internalErrors.push(error); } }).use(agentCommands());
  return Object.assign(shell, { internalErrors });
}

test("default redirect matches the native-qualified rename-retention witness", async context => {
  const fs = createMemoryFileSystem();
  const shell = setup(fs);
  context.after(() => shell.dispose());
  const source = `{ printf a; mv out moved; printf b; } >out; printf 'moved=<%s>;out=%s' "$(<moved)" "$(test -e out; printf '%s' $?)"`;
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from("moved=<ab>;out=1"));
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/moved"), Uint8Array.of(97, 98));
  await assert.rejects(fs.stat("/out"), { code: "ENOENT" });
});

const namespaceCases = [
  { name: "unlink and recreate", source: "{ printf a; rm out; printf replacement >out; printf b; } >out", files: { "/out": "replacement" } },
  { name: "duplicated position across rename", source: "{ printf a >&3; printf b >&4; mv out moved; printf c >&3; } 3>out 4>&3", files: { "/moved": "abc" }, absent: "/out", opens: 1 },
  { name: "independent simultaneous positions", source: "{ printf A >&3; printf B >&4; printf C >&3; } 3>out 4>out", files: { "/out": "BC" }, opens: 2 },
  { name: "nested truncation preserves outer offset", source: "{ printf abc; printf X >out; printf Y; } >out", files: { "/out": "X\0\0Y" }, opens: 2 },
  { name: "append across rename and replacement", source: "printf Z >out; { printf a; mv out moved; printf x >out; printf b; } >>out", files: { "/out": "x", "/moved": "Zab" } },
  { name: "independent append cursors", source: "{ printf a >&3; printf b >&4; printf c >&3; } 3>>out 4>>out", files: { "/out": "abc" }, opens: 2 },
  { name: "nested restoration across rename", source: "{ printf a; { printf x; } >inner; mv out moved; printf b; } >out", files: { "/moved": "ab", "/inner": "x" }, absent: "/out" },
];

for (const fixture of namespaceCases) test(`canonical regular output: ${fixture.name}`, async context => {
  const backing = createMemoryFileSystem();
  let opens = 0;
  let closes = 0;
  const fs = override<FileSystem>(backing, {
    capabilities: { ...backing.capabilities, randomAccessWrite: false, independentWriteStreams: false },
    async open(path, options) {
      const descriptor = await backing.open!(path, options);
      if (options.access === "read") return descriptor;
      opens++;
      return override(descriptor, { async close() { closes++; await descriptor.close(); } });
    },
    async writeStream() { assert.fail("canonical route must not use streaming"); },
  });
  const shell = setup(fs);
  context.after(() => shell.dispose());
  const result = await shell.exec(fixture.source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  for (const [path, bytes] of Object.entries(fixture.files)) assert.deepEqual(Buffer.from(await backing.readFile(path)), Buffer.from(bytes));
  if (fixture.absent) await assert.rejects(backing.stat(fixture.absent), { code: "ENOENT" });
  if (fixture.opens !== undefined) assert.equal(opens, fixture.opens);
  assert.equal(closes, opens);
});

for (const open of [false, undefined]) test(`nonaffirmative open capability preserves streaming routing: ${open}`, async context => {
  const backing = createMemoryFileSystem();
  const { open: ignoredOpen, ...capabilities } = backing.capabilities;
  assert.equal(ignoredOpen, true);
  let streams = 0;
  const shell = setup(override<FileSystem>(backing, {
    capabilities: { ...capabilities, randomAccessWrite: false, ...(open === undefined ? {} : { open }) },
    async open() { assert.fail("canonical route was not selected"); },
    async writeStream(path, source, options) { streams++; await backing.writeStream!(path, source, options); },
  }));
  context.after(() => shell.dispose());
  const result = await shell.exec("printf ab >out", { limits: { maxOutputBytes: 2 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(streams, 1);
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(97, 98));
});

test("path-specific capability selects canonical output over root legacy capability", async context => {
  const backing = createMemoryFileSystem();
  let opens = 0;
  let streams = 0;
  const shell = setup(override<FileSystem>(backing, {
    capabilities: { ...backing.capabilities, open: false, randomAccessWrite: false },
    async capabilitiesFor(path) { return { ...backing.capabilities, open: path === "/canonical", randomAccessWrite: false }; },
    async open(path, options) { opens++; return backing.open!(path, options); },
    async writeStream(path, source, options) { streams++; await backing.writeStream!(path, source, options); },
  }));
  context.after(() => shell.dispose());
  const result = await shell.exec("printf a >canonical; printf b >legacy");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(opens, 1);
  assert.equal(streams, 1);
});

test("canonical open failure never falls back to pathname or streaming writes", async context => {
  const backing = createMemoryFileSystem();
  let opens = 0;
  const shell = setup(override<FileSystem>(backing, {
    async open() { opens++; throw new FsError("ENOTSUP"); },
    async writeStream() { assert.fail("stream fallback"); },
    async writeFile() { assert.fail("pathname fallback"); },
    async appendFile() { assert.fail("pathname fallback"); },
  }));
  context.after(() => shell.dispose());
  const result = await shell.exec("printf a >out");
  assert.equal(result.exitCode, 1);
  assert.equal(opens, 1);
  await assert.rejects(backing.stat("/out"), { code: "ENOENT" });
});

for (const route of ["printf b", "bash -c 'printf b'", "sh -c 'printf b'", "forward"]) test(`counted canonical output is not charged again through ${route}`, async context => {
  const fs = createMemoryFileSystem();
  const shell = setup(fs);
  context.after(() => shell.dispose());
  shell.register({ name: "forward", execute: invocation => {
    assert.ok(invocation.invoke);
    return invocation.invoke("printf", ["b"], { stdout: invocation.stdout });
  } });
  const result = await shell.exec(`{ printf a; ${route}; } >out`, { limits: { maxOutputBytes: 2 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(97, 98));
  assert.equal(result.stdoutBytes.length, 0);
});

for (const maximum of [2, 3]) test(`named output and stdout share counted limit ${maximum}`, async context => {
  const fs = createMemoryFileSystem();
  const shell = setup(fs);
  context.after(() => shell.dispose());
  const execution = shell.exec("printf ab >out; printf c", { limits: { maxOutputBytes: maximum } });
  if (maximum === 2) await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  else { const result = await execution; assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "c"); }
  assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(97, 98));
});

test("canonical partial counts preserve all bytes under the exact shared limit", async context => {
  const backing = createMemoryFileSystem();
  let calls = 0;
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write(bytes, position, forwarded) {
      calls++; assert.equal(position, null);
      return descriptor.write(bytes.subarray(0, 1), position, forwarded);
    } });
  } }));
  context.after(() => shell.dispose());
  const result = await shell.exec("printf abc >out", { limits: { maxOutputBytes: 3 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(calls, 3);
  assert.deepEqual(Buffer.from(await backing.readFile("/out")), Buffer.from("abc"));
});

for (const reason of [false, 0, "", null]) test(`mapped close failure ${String(reason)} permits shell recovery and closes once`, async context => {
  const backing = createMemoryFileSystem();
  let closes = 0;
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() { closes++; await descriptor.close(); throw reason; } });
  } }));
  context.after(() => shell.dispose());
  const result = await shell.exec("printf a >out || printf recovered");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "recovered");
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.deepEqual(shell.internalErrors, [reason]);
  assert.equal(closes, 1);
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(97));
});

for (const reason of [false, 0, "", null]) test(`root cancellation ${String(reason)} joins the canonical write and close`, async context => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), release = deferred();
  const controller = new AbortController();
  let closes = 0;
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, {
      async write() { entered.resolve(); await release.promise; throw new Error("late writer"); },
      async close() { closes++; await descriptor.close(); throw new Error("late close"); },
    });
  } }));
  context.after(() => shell.dispose());
  const rejected = assert.rejects(shell.exec("printf a >out", { signal: controller.signal }), error => Object.is(error, reason));
  await entered.promise;
  try {
    controller.abort(reason);
    assert.equal(closes, 0);
    release.resolve();
    await rejected;
    assert.equal(closes, 1);
  } finally { release.resolve(); await rejected; }
});

test("pipeline consumer closure cancels the retained writer without escaping the mapped stage status", async context => {
  const backing = createMemoryFileSystem();
  const entered = deferred();
  let cancelled = false;
  let closes = 0;
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, {
      async write(_bytes, _position, forwarded) {
        const signal = forwarded!.signal!;
        entered.resolve();
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        cancelled = true;
        signal.throwIfAborted();
        return 0;
      },
      async close() { closes++; await descriptor.close(); },
    });
  } }));
  shell.register({ name: "producer", async execute(command) {
    assert.ok(command.invoke);
    const peerClosed = command.stdout.ownedOutput?.consumerClosed;
    assert.ok(peerClosed);
    await command.stdout.write(Buffer.from("pipe"));
    const writing = command.invoke("filewriter", []);
    void writing.catch(() => {});
    try {
      await entered.promise;
      if (!peerClosed.aborted) await once(peerClosed, "abort", { signal: command.signal });
      assert.equal(command.signal.aborted, false);
      assert.equal(cancelled, false);
      await command.stdout.write(Buffer.from("again"));
      assert.fail("A real write to the closed pipeline must fail");
    } finally { await writing; }
  } });
  shell.register({ name: "stop", async execute(command) {
    const received: number[] = [];
    for await (const chunk of command.stdin) {
      received.push(...chunk);
      if (received.length >= 4) break;
    }
    assert.deepEqual(received, [...Buffer.from("pipe")]);
    await entered.promise;
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec("filewriter() { printf a >&3; }; producer 3>out | stop", { limits: { maxWallClockMs: 1000 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(cancelled, true);
  assert.equal(closes, 1);
});

test("a diagnosed close failure preserves a previously nonzero command status", async context => {
  const backing = createMemoryFileSystem();
  const failure = new Error("close failed");
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() { await descriptor.close(); throw failure; } });
  } }));
  shell.register({ name: "unsuccessful", async execute() { return { exitCode: 7 }; } });
  context.after(() => shell.dispose());
  const result = await shell.exec("unsuccessful >out");
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.equal(shell.internalErrors.length, 1);
  assert.equal(shell.internalErrors[0], failure);
});

for (const reason of [false, 0, "", null]) test(`ignored writer failure ${String(reason)} defeats successful completion without close-error masking`, async context => {
  const backing = createMemoryFileSystem();
  let writes = 0;
  let closes = 0;
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, {
      async write() { writes++; throw reason; },
      async close() { closes++; await descriptor.close(); throw new Error("secondary close"); },
    });
  } }));
  shell.register({ name: "ignore", async execute(invocation) {
    try { await invocation.stdout.write(Uint8Array.of(97)); } catch {}
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec("ignore >out || printf recovered");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "recovered");
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.deepEqual(shell.internalErrors, [reason]);
  assert.equal(writes, 1);
  assert.equal(closes, 1);
});

test("a failed diagnostic does not acknowledge the retained close failure", async context => {
  const backing = createMemoryFileSystem();
  const failure = new Error("close failed");
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() { await descriptor.close(); throw failure; } });
  } }));
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("printf a >out", { stderr: { async write() { throw new Error("diagnostic failed"); } } }), error => error === failure);
});

for (const count of [0, -1, 1.5, NaN, Infinity, 4]) test(`canonical runtime refuses invalid or zero write count ${String(count)}`, async context => {
  const backing = createMemoryFileSystem();
  let writes = 0;
  let closes = 0;
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, {
      async write() { writes++; return count; },
      async close() { closes++; await descriptor.close(); },
    });
  } }));
  context.after(() => shell.dispose());
  const result = await shell.exec("printf abc >out");
  assert.equal(result.exitCode, 1);
  assert.equal(writes, 1);
  assert.equal(closes, 1);
  assert.equal((await backing.stat("/out")).size, 0);
});

test("unknown write failure does not refund the shared reservation", async context => {
  const backing = createMemoryFileSystem();
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write() { throw new Error("failed"); } });
  } }));
  shell.register({ name: "ignore", async execute(invocation) {
    try { await invocation.stdout.write(Uint8Array.of(1, 2, 3)); } catch {}
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("ignore >out; printf xx", { limits: { maxOutputBytes: 3 + Buffer.byteLength("shell: line 1: failed\n") + 1 } }),
    error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

test("raw output spans bounded provider windows and partial counts without duplicate charging", async context => {
  const backing = createMemoryFileSystem();
  const bytes = Uint8Array.from({ length: 131075 }, (_value, index) => index % 256);
  const lengths: number[] = [];
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write(chunk, position, forwarded) {
      assert.equal(position, null);
      lengths.push(chunk.length);
      return descriptor.write(chunk.subarray(0, 32767), position, forwarded);
    } });
  } }));
  shell.register({ name: "raw", async execute(invocation) { await invocation.stdout.write(bytes); return { exitCode: 0 }; } });
  context.after(() => shell.dispose());
  const result = await shell.exec("raw >out", { limits: { maxOutputBytes: bytes.length } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await backing.readFile("/out"), bytes);
  assert.ok(lengths.every(length => length > 0 && length <= 65536));
  assert.equal(lengths.length, 5);
});

for (const reason of [false, 0, "", null]) test(`root cancellation ${String(reason)} joins late descriptor acquisition before settling`, async context => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), release = deferred();
  const controller = new AbortController();
  let acquisitionSignal: AbortSignal | undefined;
  let closes = 0;
  let settled = false;
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    acquisitionSignal = options.signal;
    entered.resolve();
    await release.promise;
    return override(descriptor, { async close() { closes++; await descriptor.close(); } });
  } }));
  context.after(() => shell.dispose());
  const execution = shell.exec("printf a >out", { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(execution, error => Object.is(error, reason));
  await entered.promise;
  try {
    controller.abort(reason);
    await Promise.resolve();
    assert.equal(acquisitionSignal?.aborted, true);
    assert.equal(settled, false);
    assert.equal(closes, 0);
  } finally { release.resolve(); await rejected; }
  assert.equal(closes, 1);
});

test("escaping execution failure remains primary over canonical close failure", async context => {
  const backing = createMemoryFileSystem();
  const primary = new ShellLimitError("maxCommands");
  let closes = 0;
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() { closes++; await descriptor.close(); throw new Error("secondary close"); } });
  } }));
  shell.register({ name: "escape", async execute() { throw primary; } });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("escape >out"), error => error === primary);
  assert.equal(closes, 1);
});

test("affirmative capability with no canonical method refuses without fallback", async context => {
  const backing = createMemoryFileSystem();
  const shell = setup(override<FileSystem>(backing, {
    open: undefined,
    async writeStream() { assert.fail("stream fallback"); },
    async writeFile() { assert.fail("path fallback"); },
  }));
  context.after(() => shell.dispose());
  const result = await shell.exec("printf a >out");
  assert.equal(result.exitCode, 1);
  await assert.rejects(backing.stat("/out"), { code: "ENOENT" });
});

for (const source of ["exit 7 >out", "f() { return 7 >out; }; f"]) test(`control completion diagnoses close failure without replacing status: ${source}`, async context => {
  const backing = createMemoryFileSystem();
  const failure = new Error("close failed");
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() { await descriptor.close(); throw failure; } });
  } }));
  context.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.equal(shell.internalErrors.length, 1);
  assert.equal(shell.internalErrors[0], failure);
});

for (const redirect of ["&>out", "2>err >out"]) test(`close diagnostics use restored stderr after ${redirect}`, async context => {
  const backing = createMemoryFileSystem();
  const failure = new Error("close failed");
  let closes = 0;
  const shell = setup(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() {
      closes++;
      await descriptor.close();
      if (path === "/out") throw failure;
    } });
  } }));
  context.after(() => shell.dispose());
  const result = await shell.exec(`printf a ${redirect} || printf recovered`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "recovered");
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.equal(shell.internalErrors.length, 1);
  assert.equal(shell.internalErrors[0], failure);
  assert.equal(closes, redirect === "&>out" ? 1 : 2);
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(97));
});
