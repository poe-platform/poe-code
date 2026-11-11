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
  ["ns=214748364:d=0.0005", 8, 4, [9000, 1000, -3000]],
  ["nb_samples=214748364:duration=0.0005", 8, 4, [9000, 1000, -3000]],
  ["d=0.0005:ns=214748364", 8, 4, [9000, 1000, -3000]],
  ["214748364:0.0005", 8, 4, [9000, 1000, -3000]],
  ["ns=214748365:d=0.0005", 8, 0, []],
  ["nb_samples=214748365:duration=0.0005", 8, 0, []],
  ["d=0.0005:ns=214748365", 8, 0, []],
  ["214748365:0.0005", 8, 0, []],
  ["ns=0", 8, 0, []],
  ["ns=4:c1=unknown", 8, 0, []],
  ["ns=4:o=2", 8, 0, []]
] as const) {
  it(`acrossfade preserves both inputs and the transition (${options})`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "sentinel" });
    for (const [name, value] of [["a", 12000], ["b", -4000]] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(length).fill(value / 32768)] }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex", `[0:a][1:a]acrossfade=${options}[mix]`, "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("acrossfade:"), stderr);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "sentinel");
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

// FFmpeg 7.0.2 emits only the first input's prefix if either fade is incomplete.
for (const [aLength, bLength] of [[1301, 37], [37, 1301], [37, 37]] as const) {
  for (const fade of [37, 38, 128]) {
    for (const overlap of [0, 1]) {
      it(`acrossfade handles EOF (${aLength}/${bLength}, ns=${fade}, o=${overlap})`, async () => {
        const volume = Volume.fromJSON({});
        for (const [name, length, value] of [["a", aLength, 11840], ["b", bLength, -3996]] as const) {
          volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
            channels: [new Float64Array(length).fill(value / 32768)] }));
        }
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
            `[0:a][1:a]acrossfade=ns=${fade}:o=${overlap}[mix]`, "-map", "[mix]", "-f", "s16le", "/out.pcm"],
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
        const output = volume.readFileSync("/out.pcm") as Buffer;
        const samples = Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
        const prefix = new Array(Math.max(0, aLength - fade)).fill(11840);
        if (fade > Math.min(aLength, bLength)) {
          assert.deepEqual(samples, prefix);
        } else {
          assert.equal(samples.length, aLength + bLength - (overlap ? fade : 0));
          assert.deepEqual(samples.slice(0, prefix.length), prefix);
          assert.equal(samples[prefix.length], Math.round(11840 * (fade - 1) / fade));
          assert.equal(samples[aLength - 1], overlap ? Math.round(-3996 * (fade - 1) / fade) : 0);
          assert.deepEqual(samples.slice(aLength + (overlap ? 0 : fade)), new Array(bLength - fade).fill(-3996));
        }
      });
    }
  }
}
