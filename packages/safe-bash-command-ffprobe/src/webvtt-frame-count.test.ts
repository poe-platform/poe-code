import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = new TextEncoder().encode("WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n");

for (const route of ["file", "stdin"]) {
  for (const count of [false, true]) {
    it(`keeps WebVTT read counts separate from declared frames via ${route}, count=${count}`, async () => {
      const args = ["-v", "error", ...(count ? ["-count_packets", "-count_frames"] : []),
        "-show_entries", "stream=nb_frames,nb_read_frames,nb_read_packets", "-of", "json",
        route === "file" ? "/voices.vtt" : "-"];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/voices.vtt", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (route === "stdin") yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const expected = { programs: [], stream_groups: [],
        streams: [count ? { nb_read_packets: "2", nb_read_frames: "2" } : {}] };
      expect(JSON.parse(output)).toEqual(expected);
      expect(JSON.parse(evalSyncFfprobe(route === "stdin" ? bytes : undefined, args, () => bytes)!)).toEqual(expected);
    });
  }
}
