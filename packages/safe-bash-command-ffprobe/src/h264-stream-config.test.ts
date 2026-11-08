import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const fixture of ["h264-b-frames.mp4", "h264-edit-list.mp4", "aac-external.mp4"]) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
  for (const mode of ["file", "stdin", "sync"]) {
    it(`reports H.264 configuration for ${fixture} via ${mode}`, async () => {
      const args = ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=chroma_location,is_avc,nal_length_size,bits_per_raw_sample", "-of", "json", mode === "file" ? "/clip.mp4" : "-"];
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
      expect(JSON.parse(output).streams).toEqual([{ chroma_location: "left", is_avc: "true", nal_length_size: "4", bits_per_raw_sample: "8" }]);
    });
  }
}
