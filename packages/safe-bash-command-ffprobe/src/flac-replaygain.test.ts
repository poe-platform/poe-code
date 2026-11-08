import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { writeAudioMetadata } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native FFmpeg: one second of 440 Hz audio at 8 kHz, without Replay Gain tags.
const clean = readFileSync(new URL("./fixtures/replaygain.flac", import.meta.url));
const replayGain = [{ side_data_type: "Replay Gain" }];
// Native ffprobe exposes the side-data type, not the gain/peak numbers.
for (const [name, tags, expected] of [
  ["untagged", {}, undefined],
  ["track", { REPLAYGAIN_TRACK_GAIN: "-6.00 dB", REPLAYGAIN_TRACK_PEAK: "0.75" }, replayGain],
  ["track and album", { REPLAYGAIN_TRACK_GAIN: "-6.00 dB", REPLAYGAIN_TRACK_PEAK: "0.75", REPLAYGAIN_ALBUM_GAIN: "-3.00 dB", REPLAYGAIN_ALBUM_PEAK: "0.9" }, replayGain],
  ["album only", { replaygain_album_gain: "-3.00 dB" }, replayGain],
  ["peak only", { REPLAYGAIN_TRACK_PEAK: "0.75" }, undefined],
  ["nonnumeric gain", { REPLAYGAIN_TRACK_GAIN: "nonsense" }, replayGain]
] as const) {
  it(`reports ${name} FLAC Replay Gain through every probe reader`, async () => {
    const bytes = writeAudioMetadata(clean, tags);
    const plugin = flacAst();
    expect(plugin.probe(bytes).streams[0]?.side_data_list).toEqual(expected);
    expect((await plugin.probeMetadata!({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } })).streams[0]?.side_data_list).toEqual(expected);
    expect((await plugin.probeMetadataStream!((async function* () {
      for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
    })())).streams[0]?.side_data_list).toEqual(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.flac", bytes);
    for (const target of ["/input.flac", "-"]) for (const selection of [
      ["-show_streams", "-show_format"],
      ["-show_entries", "stream=index:stream_side_data=side_data_type"]
    ]) {
      const args = ["-v", "error", ...selection, "-of", "json", target];
      let output = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(output).streams[0].side_data_list).toEqual(expected);
      if (selection[0] === "-show_streams" && "REPLAYGAIN_TRACK_GAIN" in tags) expect(JSON.parse(output).format.tags.REPLAYGAIN_TRACK_GAIN).toBe(tags.REPLAYGAIN_TRACK_GAIN);
      expect(JSON.parse(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)!).streams[0].side_data_list).toEqual(expected);
    }
  });
}
