import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { oscilloscope } from "./oscilloscope.js";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string) {
  const volume = Volume.fromJSON({});
  for (let t = 0; t < 2; t++) {
    const data = Uint8Array.from(Array.from({ length: 768 }, (_, i) => {
      const x = i % 32, y = Math.floor(i / 32);
      return [(7*x+3*y+87*t)%256, (2*x+9*y+53*t)%256, (4*x+11*y+23*t)%256, 255];
    }).flat());
    volume.writeFileSync(`/f${t}.png`, encodeImage({ width: 32, height: 24, channels: 4, data,
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "info", "-y", "-framerate", "5", "-i", "/f%d.png", "-vf", filter, "/o%d.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    }, stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}
for (const filter of ["null", "oscilloscope"]) it(`renders two frames with ${filter}`, async () => {
  const { result, volume, error } = await run(filter);
  assert.equal(result.exitCode, 0, error);
  const hashes = ["c036994fb6db2db815f2b2ba0ffe4c73", "67717ee1f51ea17d4e4baa299cbe5c62"];
  for (let i = 0; i < 2; i++) {
    const frame = decodeImage(volume.readFileSync(`/o${i+1}.png`) as Buffer);
    assert.equal(frame.width, 32);
    assert.equal(frame.height, 24);
    if (filter === "null") assert.deepEqual(frame.data, decodeImage(volume.readFileSync(`/f${i}.png`) as Buffer).data);
    else assert.equal(createHash("md5").update(frame.data.filter((_, j) => j % 4 !== 3)).digest("hex"), hashes[i]);
  }
  assert.equal(volume.existsSync("/o3.png"), false);
});

it("rejects unsupported oscilloscope options without writing output", async () => {
  const { result, volume, error } = await run("oscilloscope=unknown=1");
  assert.equal(result.exitCode, 1);
  assert.match(error, /oscilloscope: options/);
  assert.equal(volume.existsSync("/o1.png"), false);
});

// Decoded RGB hashes from native FFmpeg 9.0.1, including CGA statistics text.
for (const [width, height, hash] of [
  [1200, 100, "c5779e019336a6aaff7a8692a745146c"],
  [31, 23, "55932d2de2e03a7c4bade97e03519422"],
  [1, 1, "693e9af84d3dfcc71e640e005bdc5e2e"],
  [8, 8, "b5f0223a62cb71440d3a61d3c010cafd"]
] as const) it(`matches native ${width}x${height} overlay and preserves timing`, async () => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set([(7*x+3*y)%256, (2*x+9*y)%256, (4*x+11*y)%256, 255], (y*width+x)*4);
  }
  const original = data.slice();
  const input = { width, height, data, ptsSeconds: 0.2, durationSeconds: 0.2, keyframe: true };
  const output = await oscilloscope(input, 0, new MediaBudgetTracker());
  assert.deepEqual(data, original);
  assert.equal(output.ptsSeconds, 0.2);
  assert.equal(output.durationSeconds, 0.2);
  assert.equal(createHash("md5").update(output.data.filter((_, i) => i % 4 !== 3)).digest("hex"), hash);
  await assert.rejects(oscilloscope(input, 0, new MediaBudgetTracker(), AbortSignal.abort()));
});
