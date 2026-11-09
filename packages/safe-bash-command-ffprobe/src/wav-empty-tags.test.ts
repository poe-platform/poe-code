import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const mode of ["file", "stdin", "sync"]) {
  for (const tagged of [false, true]) {
    it(`preserves the format section and only emits existing WAV tags: ${mode}, tagged=${tagged}`, async () => {
      const tags = tagged ? { title: "Example", artist: "Artist" } : {};
      const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] }, { tags });
      const args = ["-v", "error", "-show_entries", "format_tags", "-of", "json", mode === "file" ? "/input.wav" : "-"];
      let output = "", diagnostic = "";
      if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.wav", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      expect(JSON.parse(output)).toEqual({ format: tagged ? { tags } : {} });
    });
  }
}
