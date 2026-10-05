import { expect, it } from "vitest";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, FsError } from "safe-bash-contracts";
import { createPptxCommand, type PptxCommandEngine, type PptxRetainedInput } from "./index.js";

it("provides caller-backed retained inputs and output sinks without whole-file reads", async () => {
  const owner = createMemoryFileSystem();
  const overrides: Partial<FileSystem> = {};
  const fs = new Proxy(owner, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await fs.mkdir("/scratch");
  await fs.writeFile("/deck.pptx", new Uint8Array(2 * 1024 * 1024 + 1).fill(7));
  let opens = 0, closes = 0, spillWrites = 0;
  const open = fs.open!.bind(fs), openRead = fs.openReadFile!.bind(fs);
  overrides.readFile = async () => { throw new Error("whole input read forbidden"); };
  overrides.open = async (path, options) => {
    expect(path.startsWith("/scratch/.storage-")).toBe(true);
    const descriptor = await open(path, options);
    return new Proxy(descriptor, { get(target, key) {
      if (key === "write") return async (...args: Parameters<typeof descriptor.write>) => { spillWrites += args[0].length; return descriptor.write(...args); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  overrides.openReadFile = async (...args) => {
    opens++;
    const handle = await openRead(...args);
    return { stat: handle.stat.bind(handle), async read(position, maximum, options) {
      expect(maximum).toBeLessThanOrEqual(16384);
      return handle.read(position, maximum, options);
    }, async close() { closes++; await handle.close(); } };
  };
  let retained: PptxRetainedInput | undefined;
  const engine: PptxCommandEngine = { async execute(request) {
    const input = retained = await request.streaming.openInput("deck.pptx", Infinity);
    expect(input.size).toBe(2 * 1024 * 1024 + 1);
    expect(await request.streaming.openInput("deck.pptx", Infinity)).toBe(input);
    expect((await input.read(input.size - 1, 100, { signal: request.signal }))).toEqual(new Uint8Array([7]));
    let count = 0;
    for await (const chunk of input.stream()) { expect(chunk.every(byte => byte === 7)).toBe(true); count += chunk.length; }
    expect(count).toBe(input.size);
    await request.streaming.stdout.write(new TextEncoder().encode("ok"));
    return { exitCode: 0 };
  } };
  const output: number[] = [];
  const args = createCommandArguments([]);
  const result = await createPptxCommand({ engine }).execute({ command: "pptx", args: args.args, argumentValues: args,
    cwd: "/", env: { TMPDIR: "/scratch" }, fs, stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(chunk) { output.push(...chunk); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(new Uint8Array(output))).toBe("ok");
  expect(opens).toBe(1); expect(closes).toBe(1);
  expect(spillWrites).toBeGreaterThan(1024 * 1024);
  expect(await fs.readdir("/scratch")).toEqual([]);
  await expect(retained!.read(0, 1, { signal: new AbortController().signal })).rejects.toMatchObject({ code: "EBADF" });
});

it("snapshots stdin incrementally and applies a smaller limit to repeated input admission", async () => {
  const fs = createMemoryFileSystem();
  let pulls = 0, ended = false;
  const engine: PptxCommandEngine = { async execute(request) {
    const input = await request.streaming.openInput("-", Infinity);
    expect(input.size).toBe(65536 * 20);
    await expect(request.streaming.openInput("-", 10)).rejects.toMatchObject({ code: "resource-limit" });
    expect((await input.read(65536 * 10, 1, { signal: request.signal }))[0]).toBe(10);
    return { exitCode: 0 };
  } };
  const args = createCommandArguments([]);
  const stdin = (async function* () {
    const chunk = new Uint8Array(65536);
    try { for (let n = 0; n < 20; n++) { pulls++; chunk.fill(n); yield chunk; } }
    finally { ended = true; }
  })();
  await createPptxCommand({ engine }).execute({ command: "pptx", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    stdin, signal: new AbortController().signal, stdout: { async write() {} }, stderr: { async write() {} } });
  expect(pulls).toBe(20); expect(ended).toBe(true); expect(await fs.readdir("/")).toEqual([]);
});

it("preserves the engine failure when owned storage cleanup also fails", async () => {
  const owner = createMemoryFileSystem();
  const primary = new Error("engine failed"), cleanup = new Error("cleanup failed");
  const fs = new Proxy(owner, { get(target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      const descriptor = await owner.open!(...args);
      return new Proxy(descriptor, { get(handle, property) {
        if (property === "close") return async (...options: Parameters<typeof descriptor.close>) => {
          try { await descriptor.close(...options); } catch (error) { if (error !== options[0]?.signal?.reason) throw error; }
          throw cleanup;
        };
        const value = Reflect.get(handle, property, handle);
        return typeof value === "function" ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const engine: PptxCommandEngine = { async execute(request) { await request.streaming.openInput("-", Infinity); throw primary; } };
  const args = createCommandArguments([]);
  await expect(createPptxCommand({ engine }).execute({ command: "pptx", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    stdin: (async function* () { const chunk = new Uint8Array(16384); for (let n = 0; n < 100; n++) yield chunk; })(),
    signal: new AbortController().signal, stdout: { async write() {} }, stderr: { async write() {} }
  })).rejects.toBe(primary);
  expect(await owner.readdir("/")).toEqual([]);
});

for (const mode of ["cancel", "changed", "limit"] as const) it(`closes retained input on ${mode} during admission`, async () => {
  const owner = createMemoryFileSystem();
  await owner.writeFile("/deck", new Uint8Array(65537).fill(1));
  const controller = new AbortController(), reason = new Error("cancel read");
  let closed = 0, reads = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<FileSystem["openReadFile"]>>) => {
      const handle = await owner.openReadFile!(...args);
      return { stat: handle.stat.bind(handle), async read(...parameters: Parameters<typeof handle.read>) {
        reads++;
        const bytes = await handle.read(...parameters);
        if (reads === 1 && mode === "cancel") controller.abort(reason);
        if (reads === 1 && mode === "changed") await owner.writeFile("/deck", new Uint8Array(65537).fill(2));
        return bytes;
      }, async close() { closed++; await handle.close(); } };
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const engine: PptxCommandEngine = { async execute(request) {
    await request.streaming.openInput("deck", mode === "limit" ? 1 : Infinity);
    return { exitCode: 0 };
  } };
  const args = createCommandArguments([]);
  const run = Promise.resolve(createPptxCommand({ engine }).execute({ command: "pptx", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    stdin: toByteSource(""), signal: controller.signal, stdout: { async write() {} }, stderr: { async write() {} } }));
  if (mode === "cancel") await expect(run).rejects.toBe(reason);
  else await expect(run).rejects.toMatchObject({ code: mode === "limit" ? "resource-limit" : "stale-input" });
  expect(closed).toBe(1);
  if (mode === "limit") expect(reads).toBe(0);
});

for (const changed of [false, true]) it(`admits opaque retained identities and detects version changes: ${changed}`, async () => {
  const owner = createMemoryFileSystem();
  await owner.writeFile("/deck", new Uint8Array([1, 2, 3]));
  const scope = {};
  const fs = new Proxy(owner, { get(target, key) {
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<FileSystem["openReadFile"]>>) => {
      const handle = await owner.openReadFile!(...args);
      let stats = 0;
      return { read: handle.read.bind(handle), close: handle.close.bind(handle), async stat(options: Parameters<typeof handle.stat>[0]) {
        const stat = await handle.stat(options);
        return { ...stat, ino: undefined, dev: undefined, revision: undefined, identityScope: scope,
          opaqueIdentity: "deck", opaqueVersion: changed && stats++ > 0 ? "v2" : "v1" };
      } };
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const engine: PptxCommandEngine = { async execute(request) {
    const input = await request.streaming.openInput("deck", Infinity);
    expect(await input.read(0, 3, { signal: request.signal })).toEqual(new Uint8Array([1, 2, 3]));
    return { exitCode: 0 };
  } };
  const args = createCommandArguments([]);
  const run = Promise.resolve(createPptxCommand({ engine }).execute({ command: "pptx", args: args.args, argumentValues: args,
    cwd: "/", env: {}, fs, stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } }));
  if (changed) await expect(run).rejects.toMatchObject({ code: "stale-input" });
  else expect((await run).exitCode).toBe(0);
});

for (const mode of ["success", "unsupported", "late-unsupported", "changed", "limit", "cancel"] as const) it(`snapshots stream-only inputs with bounded caller storage: ${mode}`, async () => {
  const owner = createMemoryFileSystem(), controller = new AbortController();
  await owner.mkdir("/scratch");
  await owner.writeFile("/deck", new Uint8Array([9]));
  const reason = new Error("cancel stream");
  let buffered = 0, ended = false, spillBytes = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === "capabilitiesFor") return async () => ({ ...owner.capabilities, retainedRead: false });
    if (key === "readFile") return async () => { buffered++; return new Uint8Array([9]); };
    if (key === "readStream") return async function* () {
      const chunk = new Uint8Array(65536);
      try {
        if (mode === "unsupported") throw new FsError("ENOTSUP");
        for (let n = 0; n < 24; n++) {
          chunk.fill(n); yield chunk;
          if (mode === "late-unsupported") throw new FsError("ENOTSUP");
          if (mode === "cancel") controller.abort(reason);
        }
        if (mode === "changed") await owner.writeFile("/deck", new Uint8Array([8]));
      } finally { ended = true; }
    };
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      expect(args[0].startsWith("/scratch/.storage-")).toBe(true);
      const handle = await owner.open!(...args);
      return new Proxy(handle, { get(descriptor, property) {
        if (property === "write") return async (...parameters: Parameters<typeof handle.write>) => {
          expect(parameters[0].length).toBeLessThanOrEqual(16384);
          spillBytes += parameters[0].length; return handle.write(...parameters);
        };
        const value = Reflect.get(descriptor, property, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const engine: PptxCommandEngine = { async execute(request) {
    const input = await request.streaming.openInput("deck", mode === "limit" ? 1 : Infinity);
    if (mode === "success") {
      expect(input.size).toBe(24 * 65536);
      let offset = 0;
      for await (const chunk of input.stream()) {
        expect(chunk.length).toBeLessThanOrEqual(16384);
        expect(chunk.every(byte => byte === Math.floor(offset / 65536))).toBe(true);
        offset += chunk.length;
      }
    } else expect(await input.read(0, 1, { signal: request.signal })).toEqual(new Uint8Array([9]));
    return { exitCode: 0 };
  } };
  const args = createCommandArguments([]);
  const run = Promise.resolve(createPptxCommand({ engine }).execute({ command: "pptx", args: args.args, argumentValues: args,
    cwd: "/", env: { TMPDIR: "/scratch" }, fs, stdin: toByteSource(""), signal: controller.signal,
    stdout: { async write() {} }, stderr: { async write() {} } }));
  if (mode === "cancel") await expect(run).rejects.toBe(reason);
  else if (mode === "success" || mode === "unsupported") expect((await run).exitCode).toBe(0);
  else await expect(run).rejects.toMatchObject({ code: mode === "limit" ? "resource-limit" : mode === "changed" ? "stale-input" : "io-failure" });
  expect(buffered).toBe(mode === "unsupported" ? 1 : 0);
  expect(ended).toBe(true);
  if (mode === "success") expect(spillBytes).toBeGreaterThan(1024 * 1024);
  expect(await owner.readdir("/scratch")).toEqual([]);
});

for (const mode of ['replay', 'protected-first', 'protected-last', 'in-place'] as const) it(`keeps input identity after source-cache eviction: ${mode}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/inputs'); await fs.mkdir('/scratch');
  for (let n = 0; n < 260; n++) await fs.writeFile(`/inputs/${n}`, new Uint8Array([n % 256]));
  let opened = 0;
  const owner = new Proxy(fs, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'openReadFile') return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => { opened++; return fs.openReadFile!(...args); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const engine: PptxCommandEngine = { async execute(request) {
    let earliest: PptxRetainedInput | undefined;
    for (let n = 0; n < 260; n++) { const input = await request.streaming.openInput(`/inputs/${n}`, Infinity); if (!n) earliest = input; }
    if (mode === 'replay') await fs.writeFile('/inputs/0', new Uint8Array([255]));
    const first = await request.streaming.openInput('/inputs/0', Infinity); expect(first).not.toBe(earliest);
    expect(await first.read(0, 1, { signal: request.signal })).toEqual(new Uint8Array([0])); expect(opened).toBe(260);
    await expect(request.streaming.openInput('/inputs/0', 0)).rejects.toMatchObject({ code: 'resource-limit' });
    if (mode !== 'replay') await request.publishOutput!({ ...(mode === 'in-place' ? { inputPath: '/inputs/0' } : {}), outputPath: mode === 'protected-last' ? '/inputs/259' : '/inputs/0', bytes: toByteSource(new Uint8Array([42])), originalBytes: first, inPlace: mode === 'in-place', force: true, dryRun: false });
    return { exitCode: 0 };
  } };
  const args = createCommandArguments([]), run = Promise.resolve(createPptxCommand({ engine }).execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs: owner, stdin: toByteSource(''), signal: new AbortController().signal, stdout: { async write() {} }, stderr: { async write() {} } }));
  if (mode.startsWith('protected')) await expect(run).rejects.toMatchObject({ code: 'io-failure' }); else expect((await run).exitCode).toBe(0);
  expect(await fs.readFile('/inputs/0')).toEqual(new Uint8Array([mode === 'replay' ? 255 : mode === 'in-place' ? 42 : 0])); expect(await fs.readdir('/scratch')).toEqual([]);
});
