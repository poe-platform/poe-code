import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 hashes of decoded row-major RGBA pixels.
for (const [height, options, hash] of [
  [1, ":split_channels=1", "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925"],
  [1, ":split_channels=0:colors=white", "d28f4c932f5ab1d8bb2b8fb115cc53b5e8c8dc2c1f25468723cd351dff14b547"],
  [2, ":split_channels=1", "b9963c1eaf10e272340fe5c189f984855ee4b51f959911dc08ea613ac9497684"]
] as const) {
  it(`matches native showwavespic channel colors at height ${height}: ${options}`, async () => {
    const channels = [
      [1000, -1000, 4000, -8000, 16000, -16000, 32000, -32000],
      [24000, -2000, 12000, -24000]
    ].map(samples => Float64Array.from({ length: 32 }, (_, i) => samples[i % samples.length]! / 32768));
    const volume = Volume.fromJSON({
      "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels }, { bitsPerSample: 16 }))
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex", `showwavespic=s=8x${height}${options}`,
        "-frames:v", "1", "/out.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(output.width, 8);
    assert.equal(output.height, height);
    assert.equal(createHash("sha256").update(output.data).digest("hex"), hash);
  });
}
