import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [options, expected] of [
  ["channel_layout=2 channels (FL+FR)", [10, 100, 20, 200, 30, 300]],
  ["channel_layout=FL+FR", [10, 100, 20, 200, 30, 300]],
  ["channel_layout=stereo", [10, 100, 20, 200, 30, 300]],
  ["2:2 channels (FL+FR)", [10, 100, 20, 200, 30, 300]],
  ["channel_layout=2 channels (FR+FL):map=0.0-FL|1.0-FR", [100, 10, 200, 20, 300, 30]],
  ["channel_layout=2 channels (FL@left+FR@right)", [10, 100, 20, 200, 30, 300]],
  ["channel_layout=1 channels (FC)", [10, 20, 30]],
  ["channel_layout=stereo:channel_layout=2 channels (FL+FR)", [10, 100, 20, 200, 30, 300]],
  ["channel_layout=3 channels (FL+FR)", undefined],
  ["channel_layout=0 channels (FL+FR)", undefined],
  ["channel_layout=2 channels (FL+FR", undefined],
  ["channel_layout=2 channels (FL+BOGUS)", undefined],
  ["channel_layout=2 channels (FL+FL)", [10, 100, 20, 200, 30, 300]],
  ["channel_layout=2 channels (FL+FR))", undefined],
  ["channel_layout=3 channels (FL+FR):channel_layout=stereo", undefined]
] as const) {
  it(`join handles an explicit channel count and speaker list: ${options}`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "preserve" });
    for (const [index, samples] of [[10, 20, 30, 40, 50], [100, 200, 300]].entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        `[0:a][1:a]join=${options}[out]`, "-map", "[out]", "-bitexact", "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    const bytes = volume.readFileSync("/out.pcm") as Buffer;
    if (!expected) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("join"), stderr);
      assert.equal(bytes.toString(), "preserve");
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(bytes.length, expected.length * 2);
    assert.deepEqual(expected.map((_, index) => bytes.readInt16LE(index * 2)), expected);
  });
}
