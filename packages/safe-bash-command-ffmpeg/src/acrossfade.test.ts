import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [options, length, fade, expected] of [
  ["ns=2000", 8000, 2000, [11994, 3994, -3998]],
  ["ns=4:o=1", 8, 4, [9000, 1000, -3000]],
  ["ns=4:o=0", 8, 4, [9000, 3000, 0]],
  ["d=0.0005", 8, 4, [9000, 1000, -3000]],
  ["nb_samples=4:overlap=true:curve1=tri:curve2=tri", 8, 4, [9000, 1000, -3000]],
  ["ns=0", 8, 0, []],
  ["ns=9", 8, 0, []],
  ["ns=4:c1=unknown", 8, 0, []],
  ["ns=4:o=2", 8, 0, []]
] as const) {
  it(`acrossfade preserves both inputs and the transition (${options})`, async () => {
    const volume = Volume.fromJSON({});
    for (const [name, value] of [["a", 12000], ["b", -4000]] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(length).fill(value / 32768)] }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/a.wav", "-i", "/b.wav", "-filter_complex", `[0:a][1:a]acrossfade=${options}[mix]`, "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (!expected.length) {
      assert.equal(result.exitCode, 1);
      assert.ok(stderr.includes("acrossfade:"), stderr);
      assert.equal(volume.existsSync("/out.wav"), false);
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const samples = Array.from(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!, value => Math.round(value * 32768));
    const overlap = !options.includes("o=0");
    assert.equal(samples.length, 2 * length - (overlap ? fade : 0));
    assert.deepEqual(samples.slice(0, length - fade), new Array(length - fade).fill(12000));
    assert.deepEqual(samples.slice(-(length - fade)), new Array(length - fade).fill(-4000));
    assert.deepEqual([samples[length - fade], samples[length - fade / 2], samples[length - 1]], expected);
    if (!overlap) assert.deepEqual(samples.slice(length, length + fade), [0, -1000, -2000, -3000]);
  });
}
