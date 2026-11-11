import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM and ashowinfo records from the reported reproductions.
const input = [1, 2, 3, 4, 5, 6, 7, 8];
for (const [name, graph, expected, lengths] of [
  ["first pad packet 3", "[0:a]asplit[a][b];[a]apad=pad_len=7:packet_size=3[p];[p][b]acrossfade=ns=2", [...input, 0], [6, 3]],
  ["first pad packet 2", "[0:a]asplit[a][b];[a]apad=pad_len=7:packet_size=2[p];[p][b]acrossfade=ns=2", input, [6, 2]],
  ["first trim", "[0:a]asplit[a][b];[a]atrim=end_sample=4[l];[l][b]acrossfade=ns=2", [1, 2], [2]],
  ["second pad", "[0:a]asplit[a][b];[b]apad=pad_len=7:packet_size=3[p];[a][p]acrossfade=ns=2", [1, 2, 3, 4, 5, 6, 3, 1, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0], [6, 2, 6, 3, 3, 1]],
  ["standalone pad", "[0:a]apad=pad_len=7:packet_size=3", [...input, 0, 0, 0, 0, 0, 0, 0], [8, 3, 3, 1]]
] as const) {
  for (const showInfo of [false, true]) {
    it(`acrossfade split length: ${name}, ashowinfo=${showInfo}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
        channels: [Float64Array.from(input, value => value / 32768)] }));
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-nostats", "-v", "info", "-i", "/in.wav", "-filter_complex",
          `${graph}${showInfo ? ",ashowinfo" : ""}[out]`, "-map", "[out]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
      if (showInfo) {
        const frames = stderr.split("\n").filter(line => line.includes("nb_samples:"));
        assert.equal(frames.length, lengths.length, stderr);
        let pts = 0;
        for (const [n, length] of lengths.entries()) {
          assert.ok(frames[n]!.includes(`n:${n} pts:${pts} `), frames[n]);
          assert.ok(frames[n]!.includes(`nb_samples:${length} `), frames[n]);
          pts += length;
        }
      }
    });
  }
}
