import assert from "node:assert/strict";
import test from "node:test";
import { archiveCommands, csplitCommands, createMemoryFileSystem, FsError, Shell, type FileSystem } from "../../src/index.js";

async function rpcAdapter(backend: FileSystem, before?: (method: string, args: unknown[]) => Promise<void>): Promise<{ fs: FileSystem; calls: string[] }> {
  const serverScope = (await backend.lstat("/")).identityScope;
  const clientScope = Object.freeze({ namespace: "test-rpc" });
  const calls: string[] = [];
  const operations = new Set(["stat", "lstat", "readFile", "writeFile", "appendFile", "mkdir", "rm", "rename", "readdir", "realpath", "readlink", "symlink", "chmod", "utimes", "access", "capabilitiesFor", "createStagedFile", "publishStagedFile", "removeStagedFile", "prepareDirectory", "writeFileConditional", "removeFileConditional"]);
  const encode = (value: unknown): string => JSON.stringify(value, (key, item: unknown) => {
    if (key === "signal") return undefined;
    if (key === "identityScope") return { scope: "test-rpc" };
    if (item instanceof Uint8Array) return { bytes: [...item] };
    if (item && typeof item === "object" && "type" in item && item.type === "Buffer" && "data" in item && Array.isArray(item.data)) return { bytes: item.data };
    return item;
  });
  const decode = (value: string, server: boolean): unknown => JSON.parse(value, (key, item: unknown) => {
    if (key === "identityScope") return server ? serverScope : clientScope;
    if (item && typeof item === "object" && "bytes" in item && Array.isArray(item.bytes)) return Uint8Array.from(item.bytes);
    return item;
  });
  const fs = new Proxy(backend, { get(target, method) {
    if (["readStream", "writeStream", "openReadFile", "openResizeFile", "compareEntry"].includes(String(method))) return undefined;
    const value: unknown = Reflect.get(target, method);
    if (typeof value !== "function") return value;
    if (!operations.has(String(method))) return value.bind(target);
    return async (...args: unknown[]) => {
      calls.push(String(method));
      const copied = decode(encode(args), true) as unknown[];
      const options = args.at(-1);
      if (options && typeof options === "object" && "signal" in options) Object.assign(copied.at(-1) as object, { signal: options.signal });
      await before?.(String(method), copied);
      const result: unknown = await Reflect.apply(value, target, copied);
      return result === undefined ? undefined : decode(encode(result), false);
    };
  } });
  return { fs, calls };
}

test("bounded RPC writes and atomic rename alone safely refuse ZIP and csplit", async context => {
  const backend = createMemoryFileSystem();
  await backend.writeFile("/input", Buffer.from("one\ntwo\n"));
  const { fs } = await rpcAdapter(backend);
  const unavailable = new Set(["createStagedFile", "publishStagedFile", "removeStagedFile", "prepareDirectory", "writeFileConditional", "removeFileConditional"]);
  const limited = new Proxy(fs, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, atomicFileStaging: false, atomicDirectoryMetadata: false, atomicFileMutation: false };
    if (key === "capabilitiesFor") return undefined;
    if (unavailable.has(String(key))) return undefined;
    return Reflect.get(target, key);
  } });
  const shell = new Shell({ fs: limited }).use(archiveCommands()).use(csplitCommands());
  context.after(() => shell.dispose());
  const zip = await shell.exec("zip /bundle.zip /input");
  assert.notEqual(zip.exitCode, 0);
  assert.match(zip.stderr, /ZIP publication requires atomic owned file staging/);
  const split = await shell.exec("csplit /input 2");
  assert.notEqual(split.exitCode, 0);
  assert.match(split.stderr, /atomic output mutations are not supported/);
  assert.deepEqual((await backend.readdir("/")).map(entry => entry.name), ["input"]);
});

test("serialized RPC observations preserve ZIP extraction and csplit ownership", async context => {
  const backend = createMemoryFileSystem();
  const input = Uint8Array.of(0, 255, 10, 128, 1, 10);
  await backend.writeFile("/input", input);
  const { fs, calls } = await rpcAdapter(backend);
  const first = await fs.lstat("/input"), second = await fs.lstat("/input");
  assert.notEqual(first, second);
  assert.equal(first.identityScope, second.identityScope);
  assert.notEqual(first.identityScope, (await backend.lstat("/input")).identityScope);
  const shell = new Shell({ fs }).use(archiveCommands()).use(csplitCommands());
  context.after(() => shell.dispose());
  for (const command of ["zip /bundle.zip /input", "unzip /bundle.zip -d /recovered", "csplit /recovered/input 2"]) {
    const errors: unknown[] = [];
    const result = await shell.exec(command, { onInternalError(error) { errors.push(error); } });
    assert.equal(result.exitCode, 0, `${command}: ${result.stderr} ${errors.map(error => error instanceof Error ? error.stack : String(error)).join("\n")}`);
  }
  assert.deepEqual(await backend.readFile("/recovered/input"), input);
  assert.deepEqual(await backend.readFile("/xx00"), input.subarray(0, 3));
  assert.deepEqual(await backend.readFile("/xx01"), input.subarray(3));
  for (const method of ["createStagedFile", "publishStagedFile", "removeStagedFile", "prepareDirectory", "writeFileConditional"]) assert.ok(calls.includes(method), method);
  assert.deepEqual((await backend.readdir("/")).map(entry => entry.name).sort(), ["bundle.zip", "input", "recovered", "xx00", "xx01"]);
});

for (const command of ["zip /bundle.zip /input", "csplit /input 2"]) {
  test(`RPC server conditions preserve a competing output during ${command}`, async context => {
    const backend = createMemoryFileSystem();
    await backend.writeFile("/input", Buffer.from("one\ntwo\n"));
    const destination = command.startsWith("zip") ? "/bundle.zip" : "/xx00";
    let raced = false;
    const { fs } = await rpcAdapter(backend, async (method, args) => {
      if (!raced && (method === "publishStagedFile" && args[1] === destination || method === "writeFileConditional" && args[0] === destination)) {
        raced = true;
        await backend.writeFile(destination, Buffer.from("foreign owner"));
      }
    });
    const shell = new Shell({ fs }).use(archiveCommands()).use(csplitCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(command);
    assert.equal(raced, true);
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(await backend.readFile(destination), Uint8Array.from(Buffer.from("foreign owner")));
    if (command.startsWith("csplit")) await assert.rejects(backend.lstat("/xx01"), error => error instanceof FsError && error.code === "ENOENT");
  });
}
