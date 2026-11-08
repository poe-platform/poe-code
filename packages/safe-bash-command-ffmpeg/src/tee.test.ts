import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const a = [11, 22, 33, 44];
const b = [-50, -60, -70, -80];
for (const test of [
  { target: "one.wav", maps: ["0:a"], extra: ["-map", "1:a", "-c", "copy", "two.wav"], expected: { "one.wav": a, "two.wav": b } },
  { target: "one.wav", maps: ["1:a"], extra: ["-map", "0:a", "-c", "copy", "two.wav"], expected: { "one.wav": b, "two.wav": a } },
  { target: "one.wav|two.wav", maps: ["1:a"], expected: { "one.wav": b, "two.wav": b } },
  { target: "[select=5:f=wav]one.wav", maps: ["0:a"], expected: {}, fails: true },
  { target: "one.wav|two.wav", maps: ["0:a"], expected: { "one.wav": a, "two.wav": a } },
  { target: "[select=1:f=wav]one.wav|[select=0:f=wav]two.wav", maps: ["0:a", "1:a"], expected: { "one.wav": b, "two.wav": a } },
  { target: "[select='a:1':f=wav]one.wav", maps: ["0:a", "1:a"], expected: { "one.wav": b } },
  { target: "[onfail=ignore:f=bogus]bad.x|one.wav", maps: ["0:a"], expected: { "one.wav": a }, error: "bogus" },
  { target: "[onfail=abort:f=bogus]bad.x|one.wav", maps: ["0:a"], expected: {}, fails: true },
  { target: "[onfail=ignore:f=bogus]bad.x", maps: ["0:a"], expected: {}, fails: true },
  { target: "one.wav|two.wav", maps: [], expected: {}, fails: true },
  { target: "a.wav|two.wav", maps: ["0:a"], expected: {}, fails: true }
]) {
  it(`tee ${test.target} with maps ${test.maps.join(",")}`, async () => {
    const volume = Volume.fromJSON(Object.fromEntries([a, b].map((samples, i) => [
      `/${i ? "b" : "a"}.wav`, Buffer.from(encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, n => n / 32768)] }))
    ])));
    const original = volume.readFileSync("/a.wav");
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "a.wav", "-i", "b.wav", ...test.maps.flatMap(map => ["-map", map]), "-c", "copy", ...(test.extra ? [test.target, ...test.extra] : ["-f", "tee", test.target])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode === 0, !test.fails, stderr);
    if (test.error) assert.ok(stderr.includes(test.error), stderr);
    for (const [name, samples] of Object.entries(test.expected)) {
      const audio = parseWav(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.decodedAudio!;
      assert.deepEqual(Array.from(audio.channelData[0]!, n => n * 32768), samples);
    }
    assert.deepEqual(volume.readdirSync("/"), ["a.wav", "b.wav", ...Object.keys(test.expected)].sort());
    assert.deepEqual(volume.readFileSync("/a.wav"), original);
  });
}
