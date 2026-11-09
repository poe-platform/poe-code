import { expect, it } from "vitest";
import { aiffAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe reports the nominal PCM rate even when SSND has no samples.
for (const { bits, channels, samples, bitrate } of [
  { bits: 16, channels: 1, samples: 0, bitrate: "128000" },
  { bits: 16, channels: 1, samples: 5, bitrate: "128000" },
  { bits: 8, channels: 1, samples: 0, bitrate: "64000" },
  { bits: 24, channels: 2, samples: 0, bitrate: "384000" },
  { bits: 32, channels: 2, samples: 0, bitrate: "512000" }
]) {
  const bytes = Buffer.alloc(54 + samples * channels * bits / 8);
  Buffer.from("464f524d0000002e41494646434f4d4d000000120001000000000010400bfa0000000000000053534e44000000080000000000000000", "hex").copy(bytes);
  bytes.writeUInt32BE(bytes.length - 8, 4);
  bytes.writeUInt16BE(channels, 20);
  bytes.writeUInt32BE(samples, 22);
  bytes.writeUInt16BE(bits, 26);
  bytes.writeUInt32BE(bytes.length - 46, 42);
  const name = `${bits}-bit, ${channels} channel(s), ${samples} samples`;
  const expected = { sample_rate: "8000", start_pts: 0, duration_ts: samples, bit_rate: bitrate };

  it(`reports nominal AIFF PCM bitrate in the SDK: ${name}`, () => {
    expect(aiffAst().probe(bytes).streams[0]).toMatchObject(expected);
  });

  for (const route of ["file", "stdin", "explicit", "sync"]) {
    it(`reports nominal AIFF PCM bitrate through ${route}: ${name}`, async () => {
      const args = ["-v", "error", "-show_entries",
        "stream=sample_rate,start_pts,duration_ts,bit_rate:format=bit_rate", "-of", "json",
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
      expect(probe.streams).toEqual([expected]);
      expect(probe.format.bit_rate).not.toBe(bitrate);
    });
  }
}
