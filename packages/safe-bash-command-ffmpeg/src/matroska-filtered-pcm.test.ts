import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseMkv, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = Array.from({ length: 16 }, (_, i) => (i + 1) * 100);
const right = left.map(value => -2 * value);
for (const [options, outputs] of [
  [["-af", "anull", "-c:a", "pcm_s16le", "/out.mka"], [["/out.mka", [[left, right]]]]],
  [["-filter_complex", "channelsplit[L][R]", "-map", "[L]", "-map", "[R]", "-c:a", "pcm_s16le", "/out.mka"], [["/out.mka", [[left], [right]]]]],
  [["-filter_complex", "channelsplit", "-c:a", "pcm_s16le", "/out.mka"], [["/out.mka", [[left], [right]]]]],
  [["-c:a", "pcm_s16le", "/out.mka"], [["/out.mka", [[left, right]]]]],
  [["-filter_complex", "[0:a]channelsplit[L][R]", "-map", "[L]", "/left.wav", "-map", "[R]", "/right.wav"], [["/left.wav", [[left]]], ["/right.wav", [[right]]]]]
] as const) {
  it(`preserves PCM samples and tracks: ${options.join(" ")}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [left, right].map(channel => Float64Array.from(channel, value => value / 32768)) }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...options], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    for (const [path, expected] of outputs) {
      const bytes = volume.readFileSync(path) as Buffer;
      const doc = path.endsWith(".mka") ? parseMkv(bytes) : parseWav(bytes);
      assert.equal(doc.tracks.length, expected.length);
      for (const [index, channels] of expected.entries()) {
        const track = doc.tracks[index]!;
        assert.equal(track.codecDescriptions[0]!.codecName, "pcm_s16le");
        assert.equal(track.codecDescriptions[0]!.bitsPerSample, 16);
        assert.equal(track.decodedAudio!.sampleRate, 8000);
        assert.equal(track.decodedAudio!.channels, channels.length);
        assert.deepEqual(track.decodedAudio!.channelData.map(channel => Array.from(channel, value => value * 32768)), channels);
      }
    }
  });
}
