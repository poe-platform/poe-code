import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Identical 32x16 H.264 samples with identity and 90-degree MP4 display matrices.
for (const rotation of ["identity", "90"]) {
  for (const explicit of [false, true]) for (const stdin of [false, true]) {
    it(`selects stream side data: rotation=${rotation}, explicit=${explicit}, stdin=${stdin}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/rotation-${rotation}.mp4`, import.meta.url));
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.mp4", bytes);
      const args = ["-v", "error", ...(explicit ? ["-f", "mp4"] : []),
        "-show_entries", "stream_side_data=rotation", "-of", "json", stdin ? "-" : "/input.mp4"];
      // Native ffprobe preserves an empty parent stream when no display matrix is present.
      const expected = { streams: [rotation === "90" ? { side_data_list: [{ rotation: 90 }] } : {}] };
      let output = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(output)).toEqual(expected);
      expect(JSON.parse(evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)!)).toEqual(expected);
    });
  }
}
