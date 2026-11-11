import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["time", "freq"]) {
  for (const [offset, trim, expected] of [
    ["0.0005", "end_pts=8", "ea0300000904f5012305ff024a051703"],
    ["0", "end_pts=8", "ea0300000904f5012305ff024a05170371052e0398054503be055d03e5057403"],
    ["0.0005", "end_sample=8", "ea0300000904f5012305ff024a05170371052e0398054503be055d03e5057403"]
  ] as const) {
    it(`headphone ${type} preserves source timing with offset ${offset} and ${trim}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 12 }, (_, i) => (5000 + i * 71) / 32768),
        Float64Array.from({ length: 12 }, (_, i) => (-1000 + i * 53) / 32768)
      ] }));
      volume.writeFileSync("/ir.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([16384, 0, 4096], value => value / 32768),
        Float64Array.from([0, 8192, 4096], value => value / 32768)
      ] }));
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-itsoffset", offset, "-i", "/in.wav", "-i", "/ir.wav", "-i", "/ir.wav",
          "-filter_complex", `[0:a][1:a][2:a]headphone=map=FL|FR:type=${type},atrim=${trim}[o]`,
          "-map", "[o]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stderr).toString(), "");
      // Native FFmpeg output for the same PCM fixtures and exclusive trim bounds.
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
