import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

// Native ffprobe values for the checked-in audio fixtures.
for (const [fixture, timeBase, ticks] of [
  ["s16.wav", "1/48000", 5760],
  ["tone.flac", "1/48000", 5760],
  ["cbr.mp3", "1/14112000", 2032128],
  ["tone.m4a", "1/48000", 5760]
] as const) for (const file of [true, false]) for (const selected of [true, false]) {
  it(`reports duration ticks for ${fixture}, file=${file}, selected=${selected}`, async () => {
    const bytes = readFileSync(new URL(`../../safe-bash-command-audio/fixtures/${fixture}`, import.meta.url));
    const filename = file ? `/input.${fixture}` : "-";
    const args = ["-v", "error", ...(selected
      ? ["-show_entries", "stream=time_base,duration_ts"] : ["-show_streams"]), "-of", "json", filename];
    const fs = new MemoryFileSystem();
    if (file) await fs.writeFile(filename, bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    for (const text of [output, evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)!]) {
      const stream = JSON.parse(text).streams[0];
      expect(stream.time_base).toBe(timeBase);
      if (!file && (fixture === "s16.wav" || fixture === "cbr.mp3")) {
        expect(stream).not.toHaveProperty("duration_ts");
      } else {
        expect(stream.duration_ts).toBe(ticks);
      }
    }
  });
}
