import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { toByteSource } from "safe-bash-contracts/io";
import { createSsconvertCommand } from "./commands.js";
import type { Codec } from "./codecs/types.js";

it.each(["/out.data", "fd://1"])("streams codec chunks through the injected output %s", async destination => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.data", new Uint8Array());
  const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  const writeFile = vi.spyOn(fs, "writeFile");
  const writeStream = vi.spyOn(fs, "writeStream");
  let sent = 0;
  const buffered = vi.fn(async () => { throw new Error("buffered exporter"); });
  const codec: Codec = { id: "fixture", description: "stream fixture", extensions: ["data"],
    async read() { return { sheets: [{ id: "s", name: "Data", cells: [] }] }; }, write: buffered,
    async *writeStream() { const chunk = new Uint8Array(8192); for (let i = 0; i < 32; i++) { chunk.fill(i); sent++; yield chunk; } }
  };
  const args = createCommandArguments(["-I", "fixture", "-T", "fixture", "/in.data", destination]);
  const cleanups: (() => void | Promise<void>)[] = [], errors: string[] = [];
  let outputBytes = 0;
  const context: CommandContext = { command: "ssconvert", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write(bytes) {
      await new Promise<void>(resolve => queueMicrotask(resolve));
      expect(bytes.every(byte => byte === sent - 1)).toBe(true); outputBytes += bytes.length;
    } }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }, registerCleanup(cleanup) { cleanups.push(cleanup); } };
  try {
    expect(await createSsconvertCommand({ codecs: [codec] }).execute(context), errors.join("")).toMatchObject({ exitCode: 0 });
    expect(buffered).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    if (destination.startsWith("/")) {
      expect(writeStream).toHaveBeenCalledOnce();
      expect(writeFile.mock.calls.every(([, bytes]) => bytes.length === 0)).toBe(true);
      let total = 0;
      for await (const bytes of fs.readStream(destination)) total += bytes.length;
      expect(total).toBe(32 * 8192);
      expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["in.data", "out.data"]);
    } else expect(outputBytes).toBe(32 * 8192);
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
});

it.each(["write", "cancel", "codec"] as const)("keeps the previous file and removes staging after %s failure", async failure => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), reason = new Error("stream failure");
  await fs.writeFile("/in.data", new Uint8Array());
  await fs.writeFile("/out.data", Uint8Array.of(99));
  const writeStream = fs.writeStream.bind(fs);
  vi.spyOn(fs, "writeStream").mockImplementation(async (path, source, options) => {
    const wrapped = (async function* () {
      for await (const chunk of source) {
        yield chunk;
        if (failure === "cancel") controller.abort(reason);
        if (failure === "write") throw reason;
      }
    })();
    await writeStream(path, wrapped, options);
  });
  let retired = 0;
  const codec: Codec = { id: "fixture", description: "stream fixture", extensions: ["data"],
    async read() { return { sheets: [{ id: "s", name: "Data", cells: [] }] }; },
    async write() { throw new Error("buffered exporter"); },
    async *writeStream() { try { yield Uint8Array.of(1); if (failure === "codec") throw reason; yield Uint8Array.of(2); } finally { retired++; } }
  };
  const args = createCommandArguments(["-I", "fixture", "-T", "fixture", "/in.data", "/out.data"]);
  const cleanups: (() => void | Promise<void>)[] = [];
  const context: CommandContext = { command: "ssconvert", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    signal: controller.signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup(cleanup) { cleanups.push(cleanup); } };
  await expect(createSsconvertCommand({ codecs: [codec] }).execute(context)).rejects.toBe(reason);
  for (const cleanup of cleanups.reverse()) await Promise.resolve().then(cleanup).catch(() => {});
  expect(await fs.readFile("/out.data")).toEqual(Uint8Array.of(99));
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["in.data", "out.data"]);
  expect(retired).toBe(1);
});
