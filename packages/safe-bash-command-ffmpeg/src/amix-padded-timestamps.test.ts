import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: a padded second branch outlives the first input's PTS queue.
for (const [split, inputs, filter, samples, frames] of [
  [true, "[a][p]", "amix", [1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0],
    [["0", "8"], ["NOPTS", "3"], ["NOPTS", "3"], ["NOPTS", "1"]]],
  [true, "[a][p]", "amix,aselect=isnan(pts)", [0, 0, 0, 0, 0, 0, 0],
    [["NOPTS", "3"], ["NOPTS", "3"], ["NOPTS", "1"]]],
  [true, "[a][p]", "amix,aselect=not(isnan(pts))", [1, 2, 3, 4, 5, 6, 7, 8], [["0", "8"]]],
  [true, "[p][a]", "amix", [1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0],
    [["0", "8"], ["8", "3"], ["11", "3"], ["14", "1"]]],
  [true, "[a][p]", "amix=duration=first", [1, 2, 3, 4, 5, 6, 7, 8], [["0", "8"]]],
  [false, "[a][p]", "amix", [1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0],
    [["0", "8"], ["8", "3"], ["11", "3"], ["14", "1"]]]
] as const) {
  it(`preserves padded amix timestamps: ${inputs}${filter} (split ${split})`, async () => {
    const fs = new Volume();
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
      channels: [Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8], value => value / 32768)] }));
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-nostats", "-v", "info", "-i", "/in.wav", ...(split ? [] : ["-i", "/in.wav"]), "-filter_complex",
        `${split ? "[0:a]asplit[a][b]" : "[0:a]anull[a];[1:a]anull[b]"};[b]apad=pad_len=7:packet_size=3[p];${inputs}${filter},ashowinfo[out]`,
        "-map", "[out]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return fs.readFileSync(path); },
        async stat(path: string) { return fs.statSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(output);
    assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)), samples);
    assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
      const fields = line.split(" ");
      return [fields.find(field => field.startsWith("pts:"))!.slice(4),
        fields.find(field => field.startsWith("nb_samples:"))!.slice(11)];
    }), frames);
  });
}
