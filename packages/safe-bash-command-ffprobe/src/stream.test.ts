import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

async function run(route: "stdin" | "file", options: { maxInput?: number; sourceFailure?: boolean; abort?: boolean; malformed?: boolean; failSink?: boolean } = {}) {
  const payload = 8 * 1024 * 1024, head = new Uint8Array(44), view = new DataView(head.buffer), zero = new Uint8Array(16384);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const)
    head.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, payload + 36, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, 8000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); view.setUint32(40, payload, true);
  if (options.malformed) head.fill(0, 0, 4);
  const controller = new AbortController(), base = new MemoryFileSystem();
  let closed = false, reads = 0, output = "", diagnostic = "", admitted = 0;
  async function* source() {
    try {
      reads++; yield head;
      if (options.sourceFailure) throw new Error("late read failure");
      for (let offset = 0; offset < payload; offset += zero.length) {
        if (options.abort) controller.abort(new Error("cancelled stream"));
        reads++; yield zero;
      }
    } finally { closed = true; }
  }
  const capabilities = { ...base.capabilities, retainedRead: false, streamingRead: true };
  const fs = new Proxy(base, { get(target, key) {
    if (key === "capabilities") return capabilities;
    if (key === "capabilitiesFor") return async () => capabilities;
    if (key === "openReadFile") return undefined;
    if (key === "readFile" || key === "open" || key === "writeFile") return () => { throw new Error("whole-file and spill access forbidden"); };
    if (key === "readStream") return (path: string) => { expect(path).toBe("/input.wav"); return source(); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  }});
  const context: CommandContext = {
    command: "ffprobe", ...createCommandArguments(["-f", "wav", "-of", "json", "-show_entries", "stream=duration,nb_frames", route === "stdin" ? "-" : "/input.wav"]),
    cwd: "/", env: {}, fs, signal: controller.signal,
    inputBudget: { maxBytes: payload + 44, check(bytes) { admitted = bytes; } },
    stdin: route === "stdin" ? source() : { [Symbol.asyncIterator]() { throw new Error("unexpected stdin"); } },
    stdout: { async write(bytes) {
      expect(closed).toBe(true);
      if (options.failSink) throw Object.assign(new Error("sink failed"), { code: "EPIPE" });
      output += new TextDecoder().decode(bytes);
    } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
  };
  const Original = globalThis.Uint8Array;
  globalThis.Uint8Array = new Proxy(Original, { construct(target, args) {
    if (typeof args[0] === "number" && args[0] > 65536) throw new Error("whole-payload allocation forbidden");
    return Reflect.construct(target, args);
  } });
  let error: unknown;
  try {
    const result = await Promise.resolve(createFfprobeCommand({ limits: { maxInputBytes: options.maxInput ?? payload + 44 } }).execute(context)).catch(reason => { error = reason; });
    return { result, error, closed, reads, output, diagnostic, admitted, size: payload + 44 };
  } finally { globalThis.Uint8Array = Original; }
}

for (const route of ["stdin", "file"] as const) {
  it(`streams WAV metadata from ${route} without payload storage`, async () => {
    const result = await run(route);
    expect(result.result?.exitCode, result.diagnostic).toBe(0); expect(result.closed).toBe(true);
    expect(result.admitted).toBe(result.size); expect(result.reads).toBe(513);
    expect(JSON.parse(result.output)).toEqual({ streams: [{ duration: "262.144000", nb_frames: "2048" }] });
  });
  it(`enforces ${route} admission limits incrementally and closes upstream`, async () => {
    const result = await run(route, { maxInput: 1024 });
    expect(result.result?.exitCode).toBe(1); expect(result.reads).toBe(2); expect(result.closed).toBe(true); expect(result.output).toBe("");
  });
  it(`preserves ${route} read failure priority and cleanup`, async () => {
    const result = await run(route, { malformed: true, sourceFailure: true });
    expect(result.diagnostic).toContain("late read failure"); expect(result.closed).toBe(true); expect(result.output).toBe("");
  });
  it(`cancels ${route} before consuming more chunks`, async () => {
    const result = await run(route, { abort: true });
    expect(result.error).toEqual(new Error("cancelled stream")); expect(result.closed).toBe(true); expect(result.reads).toBe(2);
  });
  it(`closes ${route} before publishing into a failed sink`, async () => {
    const result = await run(route, { failSink: true });
    expect(result.error).toMatchObject({ code: "EPIPE" }); expect(result.closed).toBe(true);
  });
}
