import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [layout, channels, expected] of [
  ["FR+FL", "FR", [[10, 20, 30]]],
  ["FR+FL", "FL", [[100, 200, 300]]],
  ["FR+FL", "all", [[10, 20, 30], [100, 200, 300]]],
  ["FR+FL", "FL+FR", [[100, 200, 300], [10, 20, 30]]],
  ["FL+FR", "FR", [[10, 20, 30]]]
] as const) {
  it(`extracts joined ${layout} channels ${channels} in speaker order`, async () => {
    const volume = new Volume();
    for (const [index, samples] of [[10, 20, 30, 40, 50], [100, 200, 300]].entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] }));
    }
    let stderr = "";
    const split = layout === "FL+FR" ? "stereo" : layout;
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        `[0:a][1:a]join=channel_layout=${layout}:map=0.0-FR|1.0-FL,channelsplit=channel_layout=${split}:channels=${channels}` +
        expected.map((_, index) => `[out${index}]`).join(""),
        ...expected.flatMap((_, index) => ["-map", `[out${index}]`, "-bitexact", "-f", "s16le", `/out${index}.pcm`])],
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
    for (const [index, samples] of expected.entries()) {
      const bytes = volume.readFileSync(`/out${index}.pcm`) as Buffer;
      assert.equal(bytes.length, samples.length * 2);
      assert.deepEqual(samples.map((_, frame) => bytes.readInt16LE(frame * 2)), samples);
    }
  });
}

for (const graph of [false, true]) {
  for (const [speaker, samples] of [["FR", [10, 20, 30]], ["FL", [100, 200, 300]]] as const) {
    it(`extracts matching custom ${speaker} after channelmap (${graph ? "graph" : "simple"})`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [[10, 20, 30], [100, 200, 300]].map(values => Float64Array.from(values, value => value / 32768)) }));
      const filter = `channelmap=0|1:FR+FL,channelsplit=FR+FL:${speaker}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-bitexact", "-f", "s16le", "/out.pcm"],
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
      const bytes = volume.readFileSync("/out.pcm") as Buffer;
      assert.equal(bytes.length, samples.length * 2);
      assert.deepEqual(samples.map((_, frame) => bytes.readInt16LE(frame * 2)), samples);
    });
  }
}
