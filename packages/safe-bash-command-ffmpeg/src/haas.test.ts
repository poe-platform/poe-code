import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [filter, impulses, mono = false] of [
    ["haas", [[0, 6000, 6000], [90, 0, 6000], [93, -6000, 0], [2048, -4000, -4000], [2138, 0, -4000], [2141, 4000, 0]]],
    ["haas,volume=0.5", [[0, 3000, 3000], [90, 0, 3000], [93, -3000, 0], [2048, -2000, -2000], [2138, 0, -2000], [2141, 2000, 0]]],
    ["haas=unknown=1", undefined],
    ["haas", [[0, 8485, 8485], [90, 0, 8485], [93, -8485, 0]], true],
    ["aformat=channel_layouts=stereo,haas", [[0, 8485, 8485], [90, 0, 8485], [93, -8485, 0]], true],
  ] as const) {
    it(`haas ${complex ? "graph" : "simple"} ${mono ? "mono" : "stereo"}: ${filter}`, async () => {
      const frames = mono ? 150 : 8192;
      const channels = Array.from({ length: mono ? 1 : 2 }, () => new Float64Array(frames));
      channels[0]![0] = 12000 / 32768;
      if (!mono) channels[1]![2048] = -8000 / 32768;
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100, channels }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (!impulses) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.existsSync("/out.wav"), false);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 2);
      assert.equal(audio.sampleRate, 44100);
      const expected = [new Array<number>(frames).fill(0), new Array<number>(frames).fill(0)];
      for (const [frame, left, right] of impulses) {
        expected[0]![frame!] = left!;
        expected[1]![frame!] = right!;
      }
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
    });
  }
}
