import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfprobeCommand } from "./media.js";
import { probe } from "./probe.js";

for (const writer of ["json", "default", "flat", "compact:s=||", "csv:s=||"]) it(`streams large WAV tag values through ${writer}`, async () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }, { tags: { title: ('héllo😀::"\\\n\r').repeat(20000) + "   ", artist: "small" } });
  const args = ["-of", writer, "-show_streams", "-show_format", "-show_entries", "stream_tags:format_tags", "/input.wav"];
  const expected = probe(bytes, args);
  const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
  let output = "", diagnostic = ""; const decoder = new TextDecoder();
  const original = JSON.stringify;
  JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
    if (typeof value === "string" && value.length > 32768) throw new Error("resident tag formatting forbidden");
    if (value && typeof value === "object") {
      const rows = value as { format?: { tags?: Record<string, string> } };
      if (rows.format?.tags?.title && rows.format.tags.title.length > 32768) throw new Error("resident tag model forbidden");
    }
    return Reflect.apply(original, JSON, [value, ...rest]);
  }) as typeof JSON.stringify;
  try {
    const result = await createFfprobeCommand({ limits: { maxOutputBytes: 4000000 } }).execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(chunk) { expect(chunk.length).toBeLessThanOrEqual(16384); output += decoder.decode(chunk, { stream: true }); } }, stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } } });
    output += decoder.decode();
    expect(result.exitCode, diagnostic).toBe(0); expect(output).toBe(expected);
  } finally { JSON.stringify = original; }
});
