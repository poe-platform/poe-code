import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: the first input selects transition precision, before s32le encoding.
for (const [firstBits, secondBits, lowBits, hash] of [
  [16, 16, 0, "35e050c042b3c674"],
  [16, 32, 0, "35e050c042b3c674"],
  [16, 32, 32767, "35e050c042b3c674"],
  [16, 32, 65535, "35e050c042b3c674"],
  [32, 16, 0, "bbddeda6212bdcaa"],
  [32, 32, 0, "bbddeda6212bdcaa"]
] as const) {
  it(`acrossfade negotiates ${firstBits}/${secondBits}-bit PCM with low bits ${lowBits}`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
    for (const [side, bitsPerSample] of [firstBits, secondBits].entries()) {
      volume.writeFileSync(`/${side}.wav`, encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 16 }, (_, i) =>
          (3001 + 17 * i) * (side ? -1 : 1) / 32768 + (side ? lowBits / 2147483648 : 0))]
      }, { bitsPerSample }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        "[0:a][1:a]acrossfade=ns=5[o]", "-map", "[o]", "-f", "s32le", "/out.pcm"],
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
    const pcm = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(pcm.length, 108);
    assert.equal(createHash("sha256").update(pcm).digest("hex").slice(0, 16), hash);
  });
}
