import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -29341, -1025, -5, -3, -1, 0, 1, 3, 5, 1025, 29341, 32767];
const halved = [-16384, -14670, -512, -2, -2, 0, 0, 0, 2, 2, 512, 14670, 16384];

// Decoded PCM16 results from native FFmpeg 7.0.2.
for (const [padded, filter, expected] of [
  [false, "volume=0.5:enable=eq(pos\\,44)", halved],
  [true, "volume=0.5:enable=eq(pos\\,44)", samples],
  [true, "volume=0.5:enable=eq(pos\\,56)", halved],
  [false, "volume=0.5:enable=eq(t\\,0)", halved],
  [true, "volume=0.5", halved],
  [true, "asetpts=PTS+8000,volume=0.5:enable=eq(pos\\,56)", halved]
] as const) {
  it(`uses WAV packet positions with padded=${padded}, ${filter}`, async () => {
    let wav = Buffer.from(encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from(samples, sample => sample / 32768)] }));
    assert.equal(wav.toString("ascii", 36, 40), "data");
    if (padded) {
      wav = Buffer.concat([wav.subarray(0, 36), Buffer.from("4a554e4b0400000000000000", "hex"), wav.subarray(36)]);
      wav.writeUInt32LE(wav.length - 8, 4);
    }
    const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
    fs.writeFileSync("/in.wav", wav);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.wav") as Buffer;
    let offset = 12;
    while (output.toString("ascii", offset, offset + 4) !== "data") {
      assert.ok(offset + 8 < output.length, "output contains a data chunk");
      const size = output.readUInt32LE(offset + 4);
      offset += 8 + size + size % 2;
    }
    const size = output.readUInt32LE(offset + 4);
    assert.deepEqual(Array.from({ length: size / 2 }, (_, i) => output.readInt16LE(offset + 8 + i * 2)), expected);
  });
}
