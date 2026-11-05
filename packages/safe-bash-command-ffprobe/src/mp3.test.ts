import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const explicit of [true, false]) for (const route of ["retained", "stream", "stdin"]) for (const writer of ["json", "json=c=1", "default", "csv", "flat", "compact"]) {
  it(`preserves ${explicit ? "explicit" : "automatic"} MP3 ${writer} output via injected ${route} input`, async () => {
    const bytes = new Uint8Array(8340); for (let pos = 0; pos < bytes.length; pos += 417) bytes.set([255, 251, 144, 0], pos);
    const base = new MemoryFileSystem(); await base.writeFile("/input.mp3", bytes);
    const args = [...(explicit ? ["-f", "mp3"] : []), "-of", writer, "-show_format", "-show_streams", "-show_packets", "-show_frames", "-count_packets", "-count_frames", route === "stdin" ? "-" : "/input.mp3"];
    const expected = evalSyncFfprobe(bytes, args, () => bytes);
    let closed = false, output = "", admitted = 0;
    const capabilities = { ...base.capabilities, retainedRead: route === "retained", streamingRead: route !== "retained" };
    async function* chunks() { const borrowed = new Uint8Array(13); try {
      for (let pos = 0; pos < bytes.length; pos += borrowed.length) { const size = Math.min(borrowed.length, bytes.length - pos); borrowed.set(bytes.subarray(pos, pos + size)); yield borrowed.subarray(0, size); }
    } finally { closed = true; } }
    const fs = new Proxy(base, { get(target, key) {
      if (key === "capabilities") return capabilities;
      if (key === "capabilitiesFor") return async () => capabilities;
      if (key === "readFile") return () => { throw new Error("whole input forbidden"); };
      if (key === "readStream") return () => chunks();
      if (key === "openReadFile") return async () => ({ stat: () => base.stat("/input.mp3"), async read(offset: number, length: number) { expect(length).toBeLessThanOrEqual(417); return bytes.slice(offset, offset + length); }, async close() { closed = true; } });
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await createFfprobeCommand().execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs, signal: new AbortController().signal,
      inputBudget: { maxBytes: bytes.length, check(total) { admitted = total; } }, stdin: route === "stdin" ? chunks() : { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { expect(closed).toBe(true); output += new TextDecoder().decode(chunk); } }, stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0); expect(output).toBe(expected); expect(admitted).toBe(bytes.length);
  });
}
it.each(["file", "stdin", "count-only", "sync"])("reports actual MP3 packet/frame counts for %s", async route => {
  const bytes = new Uint8Array(10 + 384 * 52);
  bytes.set([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 52; i++) bytes.set([255, 251, 148, 0], 10 + i * 384);
  bytes.set(new TextEncoder().encode("Info"), 46);
  const args = ["-v", "error", ...(route === "count-only" ? [] : ["-show_packets"]), "-count_packets", "-count_frames",
    "-show_entries", `${route === "count-only" ? "" : "packet=pts,duration,size:"}stream=nb_frames,nb_read_packets,nb_read_frames`, "-of", "json", route === "stdin" ? "-" : "/tone.mp3"];
  const fs = new MemoryFileSystem(); await fs.writeFile("/tone.mp3", bytes);
  let output = "";
  if (route === "sync") output = evalSyncFfprobe(bytes, args, () => bytes)!;
  else {
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
  }
  expect(JSON.parse(output)).toEqual({
    ...(route === "count-only" ? {} : { packets: Array.from({ length: 51 }, (_, i) => ({ pts: i * 338688, duration: 338688, size: "384" })) }),
    streams: [{ nb_read_packets: "51", nb_read_frames: "51" }]
  });
});
