import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import type { CommandContext } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

function fixture() {
  const bytes = new Uint8Array(44), size = 512 * 1024 * 1024 + 44, view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const)
    bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, size - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, 8000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); view.setUint32(40, size - 44, true);
  return { bytes, size };
}

async function run(options: { failRead?: Error; failClose?: Error; maxInputBytes?: number; abortRead?: boolean; failOutput?: Error; abortOpen?: boolean; failStat?: Error } = {}) {
  const { bytes, size } = fixture(), base = new MemoryFileSystem(), controller = new AbortController();
  await base.writeFile("/input.wav", bytes);
  let closes = 0, reads = 0, output = "", diagnostic = "", admitted = 0;
  const fs = new Proxy(base, { get(target, key) {
    if (key === "readFile") return async () => { throw new Error("whole-file reads forbidden"); };
    if (key === "openReadFile") return async () => {
      if (options.abortOpen) controller.abort(new Error("cancelled acquisition"));
      return ({
      stat: async () => { if (options.failStat) throw options.failStat; return { ...await base.stat("/input.wav"), size }; },
      async read(offset: number, length: number) {
        reads++; expect(length).toBeLessThanOrEqual(16); expect(offset + length).toBeLessThanOrEqual(44);
        if (options.abortRead) controller.abort(new Error("cancelled"));
        if (options.failRead) throw options.failRead;
        return bytes.slice(offset, offset + length);
      },
      async close() { closes++; if (options.failClose) throw options.failClose; }
    }); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  }});
  const context = {
    command: "ffprobe", ...createCommandArguments(["-f", "wav", "-show_entries", "stream=duration,nb_frames", "-of", "json", "/input.wav"]),
    cwd: "/", env: {}, fs, signal: controller.signal, inputBudget: { maxBytes: Number.MAX_SAFE_INTEGER, check(count: number) { admitted = count; } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk: Uint8Array) { if (options.failOutput) throw options.failOutput; output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk: Uint8Array) { diagnostic += new TextDecoder().decode(chunk); } }
  } as CommandContext;
  let error: unknown;
  const result = await Promise.resolve(createFfprobeCommand({ limits: { maxInputBytes: options.maxInputBytes ?? size } }).execute(context)).catch((reason: unknown) => { error = reason; });
  return { result, output, diagnostic, error, closes, reads, admitted, size };
}

it("uses injected retained reads for explicit WAV metadata without materializing PCM", async () => {
  const result = await run();
  expect(result.result?.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output)).toEqual({ streams: [{ duration: "16777.216000", nb_frames: "131072" }] });
  expect(result.reads).toBe(4); expect(result.closes).toBe(1); expect(result.admitted).toBe(result.size);
});
it("admits logical input size before range reads", async () => {
  const result = await run({ maxInputBytes: 1024 });
  expect(result.result?.exitCode).toBe(1); expect(result.reads).toBe(0); expect(result.closes).toBe(1);
});
it("closes on read failure and preserves the original error over cleanup failure", async () => {
  const result = await run({ failRead: new Error("reader failed"), failClose: new Error("close failed") });
  expect(result.diagnostic).toContain("reader failed"); expect(result.closes).toBe(1); expect(result.output).toBe("");
});
it("reports close failure before publishing output", async () => {
  const result = await run({ failClose: new Error("close failed") });
  expect(result.diagnostic).toContain("close failed"); expect(result.closes).toBe(1); expect(result.output).toBe("");
});
it("rechecks cancellation after range reads and closes the handle", async () => {
  const result = await run({ abortRead: true });
  expect(result.error).toEqual(new Error("cancelled")); expect(result.closes).toBe(1); expect(result.output).toBe("");
});
it("closes before sink failure", async () => {
  const result = await run({ failOutput: new Error("sink failed") });
  expect(result.diagnostic).toContain("sink failed"); expect(result.closes).toBe(1);
});

it("closes a handle delivered after cancellation during acquisition", async () => {
  const result = await run({ abortOpen: true });
  expect(result.error).toEqual(new Error("cancelled acquisition")); expect(result.closes).toBe(1); expect(result.reads).toBe(0);
});
it("closes after stat failure", async () => {
  const result = await run({ failStat: new Error("stat failed") });
  expect(result.diagnostic).toContain("stat failed"); expect(result.closes).toBe(1); expect(result.reads).toBe(0);
});

it.each(["json", "compact", "csv", "default", "flat"])("preserves the %s schema with retained metadata", async writer => {
  const bytes = new Uint8Array(4140); bytes.set(fixture().bytes);
  const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
  const args = ["-f", "wav", "-of", writer, "-show_streams", "-show_format", "-count_packets", "/input.wav"];
  let output = "";
  const expected = evalSyncFfprobe(bytes, args, () => bytes);
  const result = await createFfprobeCommand().execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } }, stderr: { async write() { throw new Error("unexpected diagnostic"); } }
  });
  expect(result.exitCode).toBe(0); expect(output).toBe(expected);
});
