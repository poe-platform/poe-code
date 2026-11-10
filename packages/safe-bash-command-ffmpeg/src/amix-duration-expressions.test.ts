import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 hashes at 8 kHz with the shorter input first.
for (const [duration, length, hash] of [
  ["max", 733, "01eca8f7ee869c02"],
  ["max+0", 733, "01eca8f7ee869c02"],
  ["default", 2048, "e2cef1367f969d5b"],
  ["default+0", 2048, "e2cef1367f969d5b"]
] as const) {
  it(`matches native amix duration=${duration} length and PCM`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
    for (const [name, length, amplitude] of [["short", 733, -4000], ["long", 2048, 12000]] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(length).fill(amplitude / 32768)] }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/short.wav", "-i", "/long.wav", "-filter_complex",
        `[0:a][1:a]amix=duration=${duration}[o]`, "-map", "[o]", "-f", "s16le", "/out.pcm"],
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
    assert.equal(pcm.length, length * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex").slice(0, 16), hash);
  });
}
