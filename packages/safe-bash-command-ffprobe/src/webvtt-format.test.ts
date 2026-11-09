import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("./fixtures/voices.vtt", import.meta.url));

for (const route of ["file", "stdin"]) {
  for (const optional of ["auto", "always", "never"]) {
    it(`omits unknown WebVTT format timing and preserves packet timing via ${route}, optional=${optional}`, async () => {
      const args = ["-v", "error", "-show_entries",
        "format=size,start_time,duration,bit_rate:packet=pts_time,dts_time,duration_time:packet_side_data=",
        "-show_optional_fields", optional, "-of", "json", route === "file" ? "/voices.vtt" : "-"];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/voices.vtt", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (route === "stdin") yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const expected = {
        packets: [
          { pts_time: "1.250000", dts_time: "1.250000", duration_time: "1.500000" },
          { pts_time: "4.000000", dts_time: "4.000000", duration_time: "0.500000" }
        ],
        format: { size: "85", ...(optional === "always" ? { start_time: "N/A", duration: "N/A", bit_rate: "N/A" } : {}) }
      };
      expect(JSON.parse(output)).toEqual(expected);
      expect(JSON.parse(evalSyncFfprobe(route === "stdin" ? bytes : undefined, args, () => bytes)!)).toEqual(expected);
    });
  }
}
