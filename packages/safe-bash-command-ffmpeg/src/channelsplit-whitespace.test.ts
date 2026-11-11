import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const options of [
    "channels=FR",
    " channels=FR",
    "channels =FR",
    "channels= FR",
    "channels=FR ",
    " channel_layout = stereo : channels = FR ",
    " stereo : FR ",
    "\tchannel_layout\t=\tstereo\t:\tchannels\t=\tFR\t",
    "channel_layout=stereo:channels=FR : threads = 1"
  ]) {
    it(`channelsplit accepts option whitespace (${graph ? "graph" : "simple"}): ${JSON.stringify(options)}`, async () => {
      const input = encodeWav({ sampleRate: 8000,
        channels: [[1000, -1000], [2000, -2000]].map(samples => Float64Array.from(samples, sample => sample / 32768)) });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `channelsplit=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
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
      assert.equal(volume.readFileSync("/out.raw").toString("hex"), "d00730f8");
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
