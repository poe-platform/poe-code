import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [101, 202, 303, 404, 505, 606];
const right = [-901, -802, -703, -604, -505, -406];
for (const [filter, expected, mask] of [
  ["anull", [left, right], undefined],
  ["channelmap=0|1", [left, right], undefined],
  ["channelmap=1|0", [right, left], undefined],
  ["channelmap=1:mono", [right], undefined],
  ["channelmap=1:FR", [right], 2]
] as const) {
  it(`writes the native WAV header and PCM after ${filter}`, async () => {
    const raw = Buffer.alloc(left.length * 4);
    for (let i = 0; i < left.length; i++) {
      raw.writeInt16LE(left[i]!, i * 4);
      raw.writeInt16LE(right[i]!, i * 4 + 2);
    }
    const volume = Volume.fromJSON({ "/out.wav": "keep" });
    volume.writeFileSync("/stereo.raw", raw);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/stereo.raw",
        "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
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
    const wav = volume.readFileSync("/out.wav") as Buffer;
    const fmt = wav.indexOf("fmt ");
    assert.equal(wav.readUInt16LE(fmt + 8), mask === undefined ? 1 : 0xfffe);
    assert.equal(wav.readUInt32LE(fmt + 4), mask === undefined ? 16 : 40);
    if (mask !== undefined) assert.equal(wav.readUInt32LE(fmt + 28), mask);
    const audio = parseWav(wav).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
  });
}
