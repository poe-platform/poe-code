import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [fixture, sizes] of [
  ["packet-positions-interleaved", [46, 5]],
  ["packet-positions-faststart", [46]],
  ["packet-positions-fragmented", [46, 5]],
  ["h264-b-frames", [45]]
] as const) {
  for (const mode of ["file", "stdin", "sync"]) {
    it(`reports native decoder configuration sizes for ${fixture} via ${mode}`, async () => {
      const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}.mp4`, import.meta.url));
      const args = ["-v", "error", "-show_entries", "stream=index,codec_name,extradata_size", "-of", "json", mode === "file" ? "/clip.mp4" : "-"];
      let output = "", diagnostic = "";
      if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/clip.mp4", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      expect(JSON.parse(output)).toEqual({ programs: [], stream_groups: [], streams: sizes.map((size, index) => ({
        index, codec_name: index === 0 ? "h264" : "aac", extradata_size: size
      })) });
    });
  }
}
