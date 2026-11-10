import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 hashes of every decoded RGBA byte, including overlapping channels.
for (const [options, hash] of [
  ["", "04b73a4202599288a216d8b5f67c151d617876b88e4d23a1c775bee889dce502"],
  [":colors=0x4080c0|0x4080c0", "9f492a73f0df2b9e38bd470b1b07c69041e5f78cd223d8996f6d03f801f72bc0"],
  [":colors=red|blue", "4e0e2e97049d7bfa9d954d1ca7851e84d24932501c562f63524a142354386efa"],
  [":split_channels=1", "0c1b0a28714a0e3725c4b36e0176198d12e20709b43e5aeb729215a5b110dd95"]
] as const) {
  it(`matches native showwavespic channel colors: ${options || "defaults"}`, async () => {
    const channels = [
      [1000, -1000, 4000, -8000, 16000, -16000, 32000, -32000],
      [24000, -2000, 12000, -24000]
    ].map(samples => Float64Array.from({ length: 32 }, (_, i) => samples[i % samples.length]! / 32768));
    const volume = Volume.fromJSON({
      "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels }))
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex", `showwavespic=s=8x8${options}`,
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
    assert.equal(output.height, 8);
    assert.equal(createHash("sha256").update(output.data).digest("hex"), hash);
  });
}
