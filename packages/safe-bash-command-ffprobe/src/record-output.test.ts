import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

async function run(mode = "success") {
  const base = new MemoryFileSystem(), head = new Uint8Array(44), size = 4 * 1024 * 1024 + 44, view = new DataView(head.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) head.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, size - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, size - 44, true);
  await base.writeFile("/input.wav", head);
  const controller = new AbortController(); let opened = 0, closed = 0, inputClosed = 0, largest = 0, transfers = 0, output = "", diagnostic = "";
  const fs = new Proxy(base, { get(target, key) {
    if (key === "readFile") return () => { throw new Error("whole input read forbidden"); };
    if (key === "openReadFile") return async () => ({
      stat: async () => ({ ...await base.stat("/input.wav"), size }),
      async read(offset: number, length: number) { expect(offset + length).toBeLessThanOrEqual(44); return head.slice(offset, offset + length); },
      async close() { inputClosed++; }
    });
    if (key === "open") return async (...args: Parameters<typeof base.open>) => {
      const handle = await base.open(...args); opened++;
      return new Proxy(handle, { get(resource, name) {
        if (name === "write") return async (...values: Parameters<typeof handle.write>) => {
          transfers++; expect(values[0].length).toBeLessThanOrEqual(16384);
          if (mode === "backing") throw new Error("backing failed");
          if (mode === "cancel") controller.abort(new Error("cancelled records"));
          return handle.write(...values);
        };
        if (name === "close") return async (...values: Parameters<typeof handle.close>) => { closed++; return handle.close(...values); };
        const value = Reflect.get(resource, name, resource); return typeof value === "function" ? value.bind(resource) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let thrown: unknown;
  const result = await Promise.resolve(createFfprobeCommand({ limits: { maxInputBytes: size, maxOutputBytes: mode === "limit" ? 100000 : 4000000 } }).execute({
    command: "ffprobe", ...createCommandArguments(["-f", "wav", "-of", "json", "-show_packets", "-show_frames", "/input.wav"]),
    cwd: "/", env: {}, fs, signal: controller.signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) {
      expect(inputClosed).toBe(1); largest = Math.max(largest, bytes.length);
      if (mode === "sink") throw Object.assign(new Error("pipe failed"), { code: "EPIPE" });
      output += new TextDecoder().decode(bytes);
    } }, stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
  })).catch(error => { thrown = error; });
  return { result, thrown, opened, closed, inputClosed, largest, transfers, output, diagnostic, remaining: (await base.readdir("/")).map(entry => entry.name) };
}

it("stages lazy packet/frame JSON in caller backing and writes bounded chunks", async () => {
  const result = await run(); expect(result.result?.exitCode, result.diagnostic).toBe(0);
  expect(result.opened).toBe(1); expect(result.closed).toBe(1); expect(result.transfers).toBeGreaterThan(4);
  expect(result.largest).toBeLessThanOrEqual(16384); expect(result.remaining).toEqual(["input.wav"]);
  const parsed = JSON.parse(result.output); expect(parsed.packets).toHaveLength(2048); expect(parsed.frames).toHaveLength(2048);
  expect(parsed.packets.at(-1)).toMatchObject({ pts: 2096128, size: "2048" }); expect(parsed.frames.at(-1).nb_samples).toBe(1024);
});
for (const mode of ["limit", "backing", "cancel", "sink"]) it(`cleans record staging after ${mode} failure`, async () => {
  const result = await run(mode); expect(result.opened).toBe(1); expect(result.closed).toBe(1); expect(result.remaining).toEqual(["input.wav"]);
  expect(result.output).toBe("");
  if (mode === "cancel") expect(result.thrown).toEqual(new Error("cancelled records"));
  else if (mode === "sink") expect(result.thrown).toMatchObject({ code: "EPIPE" });
  else { expect(result.result?.exitCode).toBe(1); expect(result.diagnostic).toContain(mode === "limit" ? "maxOutputBytes" : "backing failed"); }
});
