import { expect, it } from "vitest";
import { aiffAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe: 10062 bytes / 0.625 s gives 128793 bps, not 128794.
// The 64-byte control has an exact container bitrate of 819200 bps.
for (const [samples, offset, bitrate] of [[5000, 7, "128793"], [5, 0, "819200"]] as const) {
  const bytes = Buffer.alloc(54 + offset + samples * 2 + offset % 2);
  Buffer.from("464f524d0000002e41494646434f4d4d000000120001000000000010400bfa0000000000000053534e44000000080000000000000000", "hex").copy(bytes);
  bytes.writeUInt32BE(bytes.length - 8, 4);
  bytes.writeUInt32BE(samples, 22);
  bytes.writeUInt32BE(8 + offset + samples * 2, 42);
  bytes.writeUInt32BE(offset, 46);
  const expectedFormat = { duration: samples === 5000 ? "0.625000" : "0.000625", bit_rate: bitrate };

  it(`reports whole-bit AIFF container bitrate in the SDK with ${samples} samples`, () => {
    const probe = aiffAst().probe(bytes);
    expect(probe.format).toMatchObject(expectedFormat);
    expect(probe.streams[0]).toMatchObject({ bit_rate: "128000" });
  });

  for (const route of ["file", "stdin", "explicit", "sync"]) {
    it(`reports whole-bit AIFF container bitrate through ${route} with ${samples} samples`, async () => {
      const args = ["-v", "error", "-show_entries", "stream=bit_rate:format=duration,bit_rate", "-of", "json",
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
      const probe = JSON.parse(output);
      expect(probe.format).toEqual(expectedFormat);
      expect(probe.streams).toEqual([{ bit_rate: "128000" }]);
    });
  }
}
