import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["time", "freq"]) {
  for (const [rate, expected] of [
    [4000, "d30300005e06d2008f06c202f905460424066704c0060004ef061d04d5068b040207aa04600794048e07b2049a07f404"],
    [8000, "d3030000f103e9011004f9012e0408024c0417026b04260289043502a7044402c6045402e40463020205720221058102"]
  ] as const) {
    it(`headphone ${type} matches native with ${rate} Hz impulse responses and an 8000 Hz program`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 12 }, (_, i) => (5000 + i * 71) / 32768),
        Float64Array.from({ length: 12 }, (_, i) => (-1000 + i * 53) / 32768)
      ] }));
      volume.writeFileSync("/ir.wav", encodeWav({ sampleRate: rate, channels: [
        Float64Array.from({ length: 64 }, (_, i) => i === 0 ? 16000 / 32768 : 0),
        Float64Array.from({ length: 64 }, (_, i) => i === 1 ? 8000 / 32768 : 0)
      ] }));
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", "-i", "/ir.wav", "-i", "/ir.wav",
          "-filter_complex", `[0:a][1:a][2:a]headphone=map=FL|FR:type=${type}[o]`,
          "-map", "[o]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(errors).toString(), "");
      assert.equal(Buffer.concat(output).toString("hex"), expected);
    });
  }
}
