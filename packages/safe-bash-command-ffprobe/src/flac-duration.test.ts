import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// ffmpeg -v error -f lavfi -i sine=frequency=440:sample_rate=8000:duration=0.2 -c:a flac -f flac -
// Native ffprobe omits unknown duration/bitrate for both this file and stdin.
for (const known of [false, true]) for (const file of [false, true]) {
  it(`matches native FLAC metadata with ${known ? "known" : "unknown"} sample count via ${file ? "file" : "stdin"}`, async () => {
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/unknown-duration.flac", import.meta.url)));
    if (known) {
      const view = new DataView(bytes.buffer);
      view.setBigUint64(18, view.getBigUint64(18) | 1600n);
    }
    const args = ["-v", "quiet", "-show_entries", "stream=duration,bit_rate:format=duration,size,bit_rate", "-of", "json", file ? "/input.flac" : "-"];
    const expected = {
      streams: [known ? { duration: "0.200000" } : {}],
      format: known ? { duration: "0.200000", size: "8976", bit_rate: "359040" } : { size: "8976" }
    };
    const fs = new MemoryFileSystem();
    if (file) await fs.writeFile("/input.flac", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).streams).toEqual(expected.streams);
    expect(JSON.parse(output).format).toEqual(expected.format);
    const sync = JSON.parse(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)!);
    expect(sync.streams).toEqual(expected.streams);
    expect(sync.format).toEqual(expected.format);
  });
}
