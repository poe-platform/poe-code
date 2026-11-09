import { expect, it } from "vitest";
import { auAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const unknownLength of [false, true]) {
  const bytes = new Uint8Array(1050);
  const header = new DataView(bytes.buffer);
  [0x2e736e64, 24, unknownLength ? 0xffffffff : 1026, 3, 8000, 1]
    .forEach((value, index) => header.setUint32(index * 4, value));
  for (let index = 0; index < 513; index++) header.setInt16(24 + index * 2, index - 256);

  for (const target of ["pipe:0", "-", "/input.au"]) {
    for (const records of [[], ["-show_packets"], ["-show_frames"]]) {
      it(`preserves AU length knowledge (${unknownLength ? "unknown" : "known"}, ${target}, ${records.join(" ")})`, async () => {
        const seekable = target === "/input.au";
        const durationKnown = seekable || !unknownLength;
        const args = ["-v", "error", "-show_streams", "-show_format", ...records, "-of", "json", target];
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.au", bytes);
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        for (const probe of [JSON.parse(output),
          JSON.parse(evalSyncFfprobe(seekable ? undefined : bytes, args, () => bytes)!),
          JSON.parse(JSON.stringify(auAst().probe(bytes, { seekable })))]) {
          if (durationKnown) {
            expect(probe.streams[0].duration_ts).toBe(513);
            expect(probe.streams[0].duration).toBe("0.064125");
            expect(probe.format.duration).toBe("0.064125");
          } else {
            expect(probe.streams[0]).not.toHaveProperty("duration_ts");
            expect(probe.streams[0]).not.toHaveProperty("duration");
            expect(probe.format).not.toHaveProperty("duration");
          }
          if (seekable) {
            expect(probe.format.size).toBe("1050");
            expect(probe.format.bit_rate).toBe("130994");
          } else {
            expect(probe.format).not.toHaveProperty("size");
            if (unknownLength) expect(probe.format.bit_rate).toBe("128000");
            else expect(probe.format).not.toHaveProperty("bit_rate");
          }
        }
      });
    }
  }
}
