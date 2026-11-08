import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(100)] });

for (const section of ["packet", "frame"] as const) {
  for (const explicit of [false, true]) {
    it.each(["file", "stdin", "sync"])(`acquires ${section} entries with explicit format ${explicit} via %s`, async mode => {
      const fields = section === "packet" ? "pts,duration,size" : "pts,nb_samples";
      const args = ["-of", "json", "-show_entries", `${section}=${fields}`,
        ...(explicit ? ["-f", "wav"] : []), mode === "file" ? "/input.wav" : "-"];
      let output = "", diagnostic = "";
      if (mode === "sync") {
        output = evalSyncFfprobe(bytes, args)!;
      } else {
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
      const records = section === "packet"
        ? [{ pts: 0, duration: 100, size: "200" }]
        : [{ pts: 0, nb_samples: 100 }];
      expect(JSON.parse(output)).toEqual({ [`${section}s`]: records });
    });
  }
}
