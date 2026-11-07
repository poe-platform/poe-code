import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

for (const mode of ["file", "stdin", "sync"]) {
  for (const explicit of [false, true]) {
    it.each([
      [[], {}],
      [["-count_packets"], {}],
      [["-count_frames"], {}],
      [["-count_packets", "-show_entries", "stream=nb_read_packets"],
        { programs: [], stream_groups: [], streams: [{ nb_read_packets: "1" }] }]
    ] as const)(`only emits selected sections via ${mode}, explicit=${explicit}: %j`, async (selection, expected) => {
      const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
      const args = ["-v", "error", "-of", "json", ...(explicit ? ["-f", "wav"] : []),
        ...selection, mode === "file" ? "/tone.wav" : "-"];
      let output = "";
      if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/tone.wav", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
        });
        expect(result.exitCode).toBe(0);
      }
      expect(JSON.parse(output)).toEqual(expected);
    });
  }
}
