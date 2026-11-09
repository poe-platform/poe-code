import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const file of ["movie-rotation.mp4", "movie-rotation-cancel.mp4"]) {
  for (const target of ["/input.mp4", "pipe:0"]) {
    it(`probes the composed display matrix (${file}, ${target})`, async () => {
      const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${file}`, import.meta.url));
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.mp4", bytes);
      const args = ["-v", "error", "-show_streams", "-of", "json", target];
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () { if (target === "pipe:0") yield bytes; })(),
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      for (const text of [output, evalSyncFfprobe(target === "pipe:0" ? bytes : undefined, args, () => bytes)!]) {
        const stream = JSON.parse(text).streams[0];
        expect([stream.width, stream.height]).toEqual([32, 16]);
        expect(stream.side_data_list).toEqual(file.includes("cancel") ? undefined : [{
          side_data_type: "Display Matrix", rotation: 90,
          displaymatrix: "\n00000000:            0      -65536           0\n00000001:        65536           0           0\n00000002:            0           0  1073741824\n"
        }]);
      }
    });
  }
}
