import { expect, it } from "vitest";
import { aiffAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe -show_entries format=start_time,duration,bit_rate -of json:
// empty AIFF retains start_time but has no duration or container bitrate.
for (const samples of [0, 5]) {
  const bytes = Buffer.alloc(54 + samples * 2);
  Buffer.from("464f524d0000002e41494646434f4d4d000000120001000000000010400bfa0000000000000053534e44000000080000000000000000", "hex").copy(bytes);
  bytes.writeUInt32BE(bytes.length - 8, 4);
  bytes.writeUInt32BE(samples, 22);
  bytes.writeUInt32BE(8 + samples * 2, 42);
  const expected = samples
    ? { start_time: "0.000000", duration: "0.000625", bit_rate: "819200" }
    : { start_time: "0.000000" };

  it(`reports AIFF container timing in the SDK with ${samples} samples`, () => {
    const format = aiffAst().probe(bytes).format!;
    expect(format).toMatchObject(expected);
    if (!samples) {
      expect(format).not.toHaveProperty("duration");
      expect(format).not.toHaveProperty("bit_rate");
    }
  });

  for (const route of ["file", "stdin", "explicit", "sync"]) {
    it(`reports AIFF container timing through ${route} with ${samples} samples`, async () => {
      const args = ["-v", "error", "-show_entries", "format=start_time,duration,bit_rate", "-of", "json",
        ...(route === "explicit" ? ["-f", "aiff"] : []), route === "stdin" ? "-" : "/input.aiff"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.aiff", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        expect(diagnostic).toBe("");
      }
      expect(JSON.parse(output).format).toEqual(expected);
    });
  }
}
