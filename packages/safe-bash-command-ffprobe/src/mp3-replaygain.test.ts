import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe emits only the side-data type for these ID3v2-tagged MP3s.
const gainTags: Record<string, Record<string, string>> = {
  gainonly: { REPLAYGAIN_TRACK_GAIN: "-4.50 dB" },
  albumtext: { REPLAYGAIN_ALBUM_GAIN: "+2.25 dB", REPLAYGAIN_ALBUM_PEAK: "0.500000" },
  "native-v4": { title: "Control", audit_note: "Take2", REPLAYGAIN_TRACK_GAIN: "-4.50 dB",
    REPLAYGAIN_TRACK_PEAK: "0.750000", encoder: "Lavf61.1.100" }
};
for (const name of ["gainonly", "albumtext", "native-v4", "peakonly", "flat"]) {
  const bytes = readFileSync(new URL(`./fixtures/replaygain-${name}.mp3`, import.meta.url));
  const expected = ["peakonly", "flat"].includes(name) ? undefined : [{ side_data_type: "Replay Gain" }];
  for (const route of ["sync", "file", "stdin"] as const) for (const explicit of [false, true]) for (const selected of [false, true]) {
    it(`reports ${name} MP3 Replay Gain via ${route}, explicit=${explicit}, selected=${selected}`, async () => {
      const args = ["-v", "error", ...(explicit ? ["-f", "mp3"] : []),
        ...(selected ? ["-show_entries", "stream=index:stream_side_data=side_data_type"] : ["-show_streams", "-show_format"]),
        "-of", "json", route === "stdin" ? "-" : "/input.mp3"];
      let output = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.mp3", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() {
            for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
          } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
        });
        expect(result.exitCode).toBe(0);
      }
      const result = JSON.parse(output);
      expect(result.streams[0].side_data_list).toEqual(expected);
      if (!selected && gainTags[name]) expect(result.format.tags).toEqual(gainTags[name]);
    });
  }
}
