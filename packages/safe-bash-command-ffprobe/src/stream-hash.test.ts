import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Expected hashes recorded with native ffprobe; no packet output is requested.
for (const [fixture, algorithm, hashes] of [
  ["packet-positions-fragmented", "MD5", ["4e121371f42e24568981307a4b2536a2", "23146c1c9ff8ce81566050637440e031"]],
  ["h264-b-frames", "sha256", ["ddd2c3e2c1f857598f04b655f8d328a300d123bc2d7df580f245fa4533101632"]]
] as const) {
  for (const mode of ["file", "stdin", "sync"]) {
    it(`hashes ${fixture} configuration with ${algorithm} via ${mode}`, async () => {
      const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}.mp4`, import.meta.url));
      const args = ["-show_data_hash", algorithm, "-show_entries", "stream=index,extradata_hash,extradata", "-of", "json", mode === "file" ? "/clip.mp4" : "-"];
      let output = "";
      if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/clip.mp4", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write() {} }
        });
        expect(result.exitCode).toBe(0);
      }
      expect(JSON.parse(output)).toEqual({ programs: [], stream_groups: [], streams: hashes.map((hash, index) => ({
        index, extradata_hash: `${algorithm.toUpperCase()}:${hash}`
      })) });
    });
  }
}
