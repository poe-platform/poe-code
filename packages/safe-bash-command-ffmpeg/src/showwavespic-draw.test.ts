import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 decoded RGBA hashes for overlapping stereo channels.
for (const [options, hash] of [
  ["", "4e0e2e97049d7bfa9d954d1ca7851e84d24932501c562f63524a142354386efa"],
  [":draw=scale", "4e0e2e97049d7bfa9d954d1ca7851e84d24932501c562f63524a142354386efa"],
  [":draw=0", "4e0e2e97049d7bfa9d954d1ca7851e84d24932501c562f63524a142354386efa"],
  [":draw=full", "4fba4168dc32bd7baaf3e75fd0bec4d8619423e44cc0cd7d94637195e9f53bf0"],
  [":draw=1", "4fba4168dc32bd7baaf3e75fd0bec4d8619423e44cc0cd7d94637195e9f53bf0"]
] as const) {
  it(`matches native showwavespic drawing: ${options || "defaults"}`, async () => {
    const channels = [
      [1000, -1000, 4000, -8000, 16000, -16000, 32000, -32000],
      [24000, -2000, 12000, -24000]
    ].map(samples => Float64Array.from({ length: 32 }, (_, i) => samples[i % samples.length]! / 32768));
    const volume = Volume.fromJSON({
      "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels }))
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex", `showwavespic=s=8x8:colors=red|blue${options}`,
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
