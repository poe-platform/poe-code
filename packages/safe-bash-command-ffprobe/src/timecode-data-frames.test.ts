import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/timecode-tagged.mp4", import.meta.url));
// Native ffprobe output for the unchanged QuickTime timecode fixture.
const packet = {
  codec_type: "data", stream_index: 1, pts: 0, pts_time: "0.000000", dts: 0, dts_time: "0.000000",
  duration: 1536, duration_time: "0.120000", size: "4", pos: "48", flags: "K__",
  data: "\n00000000: 0001 6b97                                ..k.\n"
};

for (const route of ["file", "stdin", "readFile", "sync"]) {
  for (const mode of ["frames", "counts", "packets", "combined"]) {
    it(`preserves timecode packets without decoded frames (${route}, ${mode})`, async () => {
      const args = ["-v", "error", "-select_streams", "1", "-of", "json",
        ...(mode === "frames" || mode === "combined" ? ["-show_frames"] : []),
        ...(mode === "packets" || mode === "combined" ? ["-show_packets", "-show_data"] : []),
        ...(mode === "counts" || mode === "combined" ? ["-count_frames", "-count_packets",
          "-show_entries", "stream=nb_frames,nb_read_frames,nb_read_packets"] : []),
        route === "stdin" ? "pipe:0" : "/tagged.mp4"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/tagged.mp4", bytes);
        if (route === "readFile") Object.defineProperties(fs, { openReadFile: { value: undefined }, readStream: { value: undefined } });
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { if (route === "stdin") yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        expect(diagnostic).toBe("");
      }
      const probe = JSON.parse(output);
      if (mode === "frames") expect(probe.frames).toEqual([]);
      if (mode === "packets") expect(probe.packets).toEqual([packet]);
      if (mode === "combined") expect(probe.packets_and_frames).toEqual([{ type: "packet", ...packet }]);
      if (mode === "counts" || mode === "combined") {
        expect(probe.streams).toEqual([{ nb_frames: "1", nb_read_packets: "1" }]);
      }
    });
  }
}
