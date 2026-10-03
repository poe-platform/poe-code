import { expect, it, vi } from "vitest";
import { createMemoryFileSystem, FsError } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { toByteSource } from "safe-bash-contracts/io";
import { createSsconvertCommand } from "./commands.js";
import type { Codec } from "./codecs/types.js";

it.each(["retained", "stream", "fallback"] as const)("uses injected %s input without whole-file reads", async mode => {
  const backend = createMemoryFileSystem();
  await backend.writeFile("/input.data", new Uint8Array(256 * 1024).fill(42));
  const readStream = vi.fn(() => ({ [Symbol.asyncIterator]: () => ({
    async next(): Promise<IteratorResult<Uint8Array>> { throw new FsError("ENOTSUP"); }
  }) }));
  const readFile = vi.fn(async () => { throw new Error("whole payload readFile"); });
  const open = vi.fn(mode === "retained" ? async () => { throw new FsError("EROFS"); } : backend.open.bind(backend)), retained = vi.fn(backend.openReadFile.bind(backend));
  const overrides = { readStream, readFile, open, openReadFile: retained };
  const fs = new Proxy(backend, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return overrides[key as keyof typeof overrides];
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const codec: Codec = { id: "range", description: "range fixture", extensions: [],
    ...(mode === "fallback" ? { async read(bytes: Uint8Array) {
      expect(bytes.length).toBe(256 * 1024);
      return { sheets: [{ id: "s", name: "Data", cells: [] }] };
    } } : { async readSource(source: import("./contracts.js").RangeSource) {
      expect(source.size).toBe(256 * 1024);
      expect(await source.read(source.size - 2, 2)).toEqual(Uint8Array.of(42, 42));
      return { sheets: [{ id: "s", name: "Data", cells: [] }] };
    } }),
    async *writeStream() { yield Uint8Array.of(42); }
  };
  const args = createCommandArguments(["-I", "range", "-T", "range", mode === "stream" ? "fd://0" : "/input.data", "fd://1"]);
  const cleanups: (() => void | Promise<void>)[] = [], errors: string[] = [], output: number[] = [];
  const context: CommandContext = { command: "ssconvert", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: mode === "stream" ? (async function* () { const chunk = new Uint8Array(4096).fill(42); for (let i = 0; i < 64; i++) yield chunk; })() : toByteSource(""), stdout: { async write(bytes) { output.push(...bytes); } },
    stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }, registerCleanup(cleanup) { cleanups.push(cleanup); } };
  try {
    expect(await createSsconvertCommand({ codecs: [codec], workingFiles: { cacheBytes: 32768 } }).execute(context), errors.join("")).toMatchObject({ exitCode: 0 });
    expect(output).toEqual([42]); expect(readFile).not.toHaveBeenCalled();
    if (mode === "stream") { expect(open).toHaveBeenCalledOnce(); expect(retained).not.toHaveBeenCalled(); }
    else { expect(open).not.toHaveBeenCalled(); expect(retained).toHaveBeenCalledOnce(); }
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input.data"]);
});
