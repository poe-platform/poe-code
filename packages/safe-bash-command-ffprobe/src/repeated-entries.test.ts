import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const mode of ["file", "stdin", "sync"]) {
  for (const separate of [false, true]) {
    it.each([
      ["packet=size", "packet=pts"],
      ["packet=size,pts", "packet="],
      ["packet=", "packet=size,pts"],
      ["packet=size,pts", "packet=size"],
      ["packet", "packet=pts"],
      ["packet=pts", "packet"]
    ])(`accumulates entries via ${mode} with separate arguments=${separate}: %s + %s`, async (first, second) => {
      const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
      const selections = separate ? ["-show_entries", first, "-show_entries", second] : ["-show_entries", `${first}:${second}`];
      const args = ["-v", "error", "-of", "json", ...selections, mode === "file" ? "/tone.wav" : "-"];
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
      const result = JSON.parse(output);
      if (second === "packet") {
        expect(result).toEqual(JSON.parse(evalSyncFfprobe(bytes, ["-of", "json", "-show_packets", "-"])!));
      } else if (first === "packet") {
        expect(result).toEqual({ packets: [{ pts: 0 }] });
      } else {
        expect(result).toEqual({ packets: [{ pts: 0, size: "32" }] });
      }
    });
  }
}
