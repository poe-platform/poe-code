import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg outputs for two opposite-sign frames, with channel c = (c + 1) / 64.
for (const [count, layout, split, float32, float64] of [
  [1, "mono", "stereo:FL", "000000609ea0863f000000609ea086bf", "cd3b7f669ea0863fcd3b7f669ea086bf"],
  [2, "stereo", "mono:FC", "000000c076f8a03f000000c076f8a0bf", "da6cdfcc76f8a03fda6cdfcc76f8a0bf"],
  [4, "quad", "stereo:FL", "000000c076f8a83f000000c076f8a8bf", "000000c876f8a83f000000c876f8a8bf"],
  [6, "5.1", "stereo:FL", "000000609ea0ba3f000000609ea0babf", "000000609ea0ba3f000000609ea0babf"],
  [6, "5.1", "mono:FC", "000000c01d3ec53f000000c01d3ec5bf", "6f4456ae1d3ec53f6f4456ae1d3ec5bf"],
  [2, "stereo", "stereo:FR", "000000000000a03f000000000000a0bf", "000000000000a03f000000000000a0bf"]
] as const) for (const bits of [32, 64] as const) for (const graph of [false, true]) {
  it(`channelsplit preserves ${bits}-bit float gain: ${layout} to ${split} (${graph ? "graph" : "simple"})`, async () => {
    const volume = Volume.fromJSON({});
    const channels = Array.from({ length: count }, (_, channel) => Float64Array.of((channel + 1) / 64, -(channel + 1) / 64));
    const wav = Buffer.from(encodeWav({ sampleRate: 8000, channels }, { bitsPerSample: bits, float: true }));
    const extension = Buffer.from("16000000000000000300000000001000800000aa00389b71", "hex");
    extension.writeUInt16LE(bits, 2);
    extension.writeUInt32LE(({ mono: 4, stereo: 3, quad: 0x33, "5.1": 0x3f })[layout], 4);
    const input = Buffer.concat([wav.subarray(0, 36), extension, wav.subarray(36)]);
    input.writeUInt32LE(input.length - 8, 4);
    input.writeUInt32LE(40, 16);
    input.writeUInt16LE(0xfffe, 20);
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]channelsplit=${split}[out]`, "-map", "[out]"]
        : ["-af", `channelsplit=${split}`]), "-f", "f64le", "/out.raw"],
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
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), bits === 32 ? float32 : float64);
  });
}
