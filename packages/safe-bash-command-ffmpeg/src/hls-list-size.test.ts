import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 20, frameCount: 40, includeAudio: false }));
const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
  samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
})) });

async function run(values: string[], existing = false) {
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input),
    ...(existing ? { "/out.m3u8": "original playlist", "/out0.ts": "original segment" } : {}) });
  const before = volume.toJSON();
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_list_size", "0", "-hls_time", "0.2",
      ...values.flatMap(value => ["-hls_list_size", value]), "/out.m3u8"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume, before };
}

// Native FFmpeg 7.0.2: ten 0.2-second segments; validate the window and sequence
// as well as equivalence to the corresponding integer option.
for (const [value, size] of [
  ["1+1", 2], ["1.5", 2], ["2.5", 2], ["3.5", 4], ["0.5", 0], ["0.6", 1],
  ["2*(3-2)", 2], ["2^2", 4], ["0x2", 2], ["2e0", 2], ["2k", 2000],
  ["2147483647", 2147483647]
] as const) {
  it(`uses the native HLS playlist window for ${value}`, async () => {
    const actual = await run([value]);
    const control = await run([String(size)]);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(control.result.exitCode, 0, control.stderr);
    assert.deepEqual(actual.volume.toJSON(), control.volume.toJSON());
    const count = size === 0 ? 10 : Math.min(10, size);
    const lines = String(actual.volume.readFileSync("/out.m3u8")).split("\n");
    assert.equal(lines.filter(line => line.startsWith("#EXTINF:")).length, count);
    assert.ok(lines.includes(`#EXT-X-MEDIA-SEQUENCE:${10 - count}`));
    assert.equal(actual.volume.readdirSync("/").filter(name => String(name).endsWith(".ts")).length, 10);
  });
}

it("uses the last HLS list size expression", async () => {
  const actual = await run(["4", "1+1"]);
  const control = await run(["2"]);
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.equal(control.result.exitCode, 0, control.stderr);
  assert.deepEqual(actual.volume.toJSON(), control.volume.toJSON());
});

for (const value of ["-1", "-0.1", "2147483647.1", "2147483648", "2^31", "1/0", "0/0", "NaN", "", "1+", "bad"]) {
  it(`rejects invalid HLS list size ${JSON.stringify(value)} before replacing output`, async () => {
    const { result, stderr, volume, before } = await run(["2", value], true);
    assert.equal(result.exitCode, 1, stderr);
    assert.ok(stderr.includes("invalid hls_list_size"), stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}
