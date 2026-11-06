import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;

for (const inputChannels of [1, 2]) {
  for (const channels of [4, 5, 6, 7, 8]) {
    it(`preserves layout and samples when upmixing ${inputChannels} to ${channels} channels`, async () => {
      const samples = Array.from({ length: 800 }, (_, i) => (i % 2 ? -1 : 1) * (12000 + 2 * (i % 50)));
      const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: inputChannels }, (_, c) => Float64Array.from(samples, value => value / 32768 / (c + 1))) });
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", "-ac", String(channels), "-c:a", "pcm_s16le", "/out.wav"],
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
      const output = volume.readFileSync("/out.wav") as Buffer;
      const audio = parseWav(output).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, channels);
      assert.equal(output.readUInt16LE(20), 0xfffe);
      assert.equal(audio.channelMask, [0x107, 0x37, 0x3f, 0x70f, 0x63f][channels - 4]);
      assert.equal(audio.channelData[0]!.length, samples.length);
      const expected = samples.flatMap(sample => Array.from({ length: channels }, (_, channel) => inputChannels === 1 ? (channel === 2 ? sample : 0) : (channel < 2 ? sample / (channel + 1) : 0)));
      const actual = samples.flatMap((_, i) => audio.channelData.map(channel => channel[i]! * 32768));
      assert.deepEqual(actual, expected);

      if (nativeAvailable) {
        const reference = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-ac", String(channels), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], { input });
        const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], { input: output });
        assert.equal(reference.status, 0, reference.stderr.toString());
        assert.equal(decoded.status, 0, decoded.stderr.toString());
        assert.deepEqual(decoded.stdout, reference.stdout);
        const probe = spawnSync("ffmpeg", ["-hide_banner", "-guess_layout_max", "0", "-i", "pipe:0", "-f", "null", "-"], { input: output });
        assert.equal(probe.status, 0, probe.stderr.toString());
        assert.ok(probe.stderr.toString().includes(`8000 Hz, ${["4.0", "5.0", "5.1", "6.1", "7.1"][channels - 4]},`), probe.stderr.toString());
      }
    });
  }
}
