import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 16 mono PCM16 samples per input at 8000 Hz.
for (const [options, valid] of [
  ["ns=5", true],
  ["ns=5:", true],
  ["5:", true],
  ["5:0:", true],
  ["5:0:1:tri:tri:", true],
  ["nb_samples=5:duration=0:overlap=1:curve1=tri:curve2=tri:", true],
  ["ns=5::", false],
  ["ns=5::o=1", false],
  [":ns=5", false],
  ["ns=5:d=:", false],
  ["5:0:1:tri:tri:1:", false]
] as const) {
  it(`acrossfade handles option separators (${options})`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
    for (const side of [0, 1]) {
      volume.writeFileSync(`/${side}.wav`, encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 16 }, (_, i) =>
          (3001 + 17 * i) * (side ? -1 : 1) / 32768)] }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        `[0:a][1:a]acrossfade=${options}[o]`, "-map", "[o]", "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (!valid) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, 54);
    assert.equal(createHash("sha256").update(output).digest("hex").slice(0, 16), "737e6b4c9733489a");
  });
}
