import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import type { CommandContext } from "safe-bash-contracts/command";
import { writeProbeOutput } from "./probe-output.js";

it("preserves split Unicode and backpressure after complete output admission", async () => {
  const fs = new MemoryFileSystem(), received: Uint8Array[] = [];
  let release!: () => void, entered!: () => void, complete = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const firstWrite = new Promise<void>(resolve => { entered = resolve; });
  function* parts() {
    yield "x".repeat(65535); yield "\ud83d"; yield "\ude00é".repeat(2000); complete = true;
  }
  const context: CommandContext = { command: "ffprobe", args: [], cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stderr: { async write() {} }, stdout: { async write(bytes) {
      expect(complete).toBe(true); expect(bytes.length).toBeLessThanOrEqual(16384); received.push(bytes);
      if (received.length === 1) { entered(); await pending; }
    } } };
  const running = writeProbeOutput(context, parts(), () => {});
  await firstWrite; await Promise.resolve(); expect(received).toHaveLength(1);
  release(); await running;
  const output = new Uint8Array(received.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0; for (const chunk of received) { output.set(chunk, offset); offset += chunk.length; }
  expect(output).toEqual(new TextEncoder().encode("x".repeat(65535) + "\ud83d" + "\ude00é".repeat(2000)));
  expect(await fs.readdir("/")).toEqual([]);
});

it("cleans staged fragments when record enumeration fails before publication", async () => {
  const fs = new MemoryFileSystem(), reason = new Error("record failed"); let writes = 0;
  const context: CommandContext = { command: "ffprobe", args: [], cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stderr: { async write() {} }, stdout: { async write() { writes++; } } };
  function* parts() { yield "x".repeat(100000); throw reason; }
  await expect(writeProbeOutput(context, parts(), () => {})).rejects.toBe(reason);
  expect(writes).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});
