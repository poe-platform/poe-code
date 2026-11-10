import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const width of [32, 33, 34]) {
  it(`handles 32 samples per channel across ${width} waveform columns`, async () => {
    const channels = [
      [1000, -1000, 4000, -8000, 16000, -16000, 32000, -32000],
      [24000, -2000, 12000, -24000]
    ].map(samples => Float64Array.from({ length: 32 }, (_, i) => samples[i % samples.length]! / 32768));
    const volume = Volume.fromJSON({
      "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels }, { bitsPerSample: 16 }))
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `showwavespic=s=${width}x8:split_channels=1`, "-frames:v", "1", "/out.png"],
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
    if (width > 32) {
      assert.equal(volume.existsSync("/out.png"), false);
      assert.ok(stderr.includes("Too few samples"), stderr);
    } else {
      const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
      assert.equal(output.width, 32);
      assert.equal(output.height, 8);
      // Native FFmpeg 7.0.2, decoded row-major RGBA pixels.
      assert.equal(createHash("sha256").update(output.data).digest("hex"),
        "30b48a3a700f28f76ccd013404b07d41df78964a0c91eecac46a1274a07af5a8");
    }
  });
}
