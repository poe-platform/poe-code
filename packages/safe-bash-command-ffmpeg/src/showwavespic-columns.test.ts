import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Decoded RGBA SHA-256 values from FFmpeg 7.0.2 for this 32-sample stereo input.
for (const [width, filter, expected] of [
  [7, "", "63afd9a7882ec7e14d82f7998e1458190ae8bf44fe87172b7cc3a97b1c618f1a"],
  [7, ":filter=peak", "d5b4c0f3183a406ec3fcd8b33e8a2b7050e841231082101c95e734ac6511eefd"],
  [8, "", "0c1b0a28714a0e3725c4b36e0176198d12e20709b43e5aeb729215a5b110dd95"]
] as const) {
  it(`matches native showwavespic sample columns at width ${width}${filter}`, async () => {
    const patterns = [
      [1000, -1000, 4000, -8000, 16000, -16000, 32000, -32000],
      [24000, -2000, 12000, -24000]
    ];
    const channels = patterns.map(pattern => Float64Array.from(
      { length: 32 }, (_, i) => pattern[i % pattern.length]! / 32768
    ));
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })) });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `showwavespic=s=${width}x8:split_channels=1${filter}`, "-frames:v", "1", "/out.png"],
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
    assert.equal(output.width, width);
    assert.equal(output.height, 8);
    assert.equal(createHash("sha256").update(output.data).digest("hex"), expected);
  });
}
