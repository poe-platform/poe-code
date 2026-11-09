import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { probeMp4, probeMp4Source } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native FFmpeg fixture: three H.264 frames and a tmcd data track, kept unchanged.
const bytes = new Uint8Array(readFileSync(new URL("./fixtures/timecode-codec.mp4", import.meta.url)));
const fields = "stream=codec_name,codec_long_name,codec_tag_string,codec_type";
const expected = { codec_type: "data", codec_tag_string: "tmcd" };

it("omits timecode codec names from resident and source stream probes", async () => {
  const resident = probeMp4(bytes);
  const source = await probeMp4Source({
    size: bytes.length,
    async read(offset, length) { return bytes.subarray(offset, offset + length); }
  }, { syncSamples() {
    const samples = new Set<number>();
    return { add(sample: number) { samples.add(sample); }, has(sample: number) { return samples.has(sample); } };
  } });
  const streams = [];
  for await (const stream of source.streams) streams.push(stream);
  for (const rows of [resident.streams, streams]) {
    expect(rows[1]).toMatchObject(expected);
    expect(rows[1]?.codec_name).toBeUndefined();
    expect(rows[1]?.codec_long_name).toBeUndefined();
    expect(rows[0]).toMatchObject({
      codec_type: "video", codec_tag_string: "avc1", codec_name: "h264",
      codec_long_name: "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10"
    });
  }
});

it("omits timecode codec names from synchronous ffprobe JSON", () => {
  const args = ["-v", "error", "-select_streams", "1", "-show_entries", fields, "-of", "json", "/in.mp4"];
  expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!).streams).toEqual([expected]);
});

for (const input of ["file", "stdin"] as const) {
  it(`reports the timecode tag without codec names through public ffprobe using ${input}`, async () => {
    const fs = new MemoryFileSystem();
    if (input === "file") await fs.writeFile("/in.mp4", bytes);
    const args = ["-v", "error", "-select_streams", "1", "-show_entries", fields, "-of", "json", input === "file" ? "/in.mp4" : "pipe:0"];
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: (async function* () { if (input === "stdin") yield bytes; })(),
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    expect(JSON.parse(output).streams).toEqual([expected]);
  });
}
