import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

for (const unit of [false, true]) for (const route of ["file", "stdin", "explicit"]) {
  it(`formats packet units=${unit} through ${route}`, async () => {
    const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.wav", bytes);
    for (const writer of ["json", "default", "csv", "compact", "flat", "ini"]) {
      const args = ["-v", "error", ...(unit ? ["-unit"] : []), ...(route === "explicit" ? ["-f", "wav"] : []),
        "-of", writer, "-show_entries", "packet=pts,pts_time,dts_time,duration,duration_time,size,pos", route === "stdin" ? "-" : "/input.wav"];
      let output = "", error = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
      });
      expect(error).toBe("");
      expect(result.exitCode).toBe(0);
      expect(evalSyncFfprobe(bytes, args, () => bytes)).toBe(output);
      if (writer === "json") expect(JSON.parse(output)).toEqual({ packets: [{
        pts: 0, pts_time: unit ? "0.000000 s" : "0.000000", dts_time: unit ? "0.000000 s" : "0.000000",
        duration: 16, duration_time: unit ? "0.002000 s" : "0.002000", size: unit ? "32 byte" : "32", pos: "44"
      }] });
      else {
        expect(output).toContain(unit ? "0.002000 s" : "0.002000");
        expect(output.includes("32 byte")).toBe(unit);
      }
    }
  });
}
