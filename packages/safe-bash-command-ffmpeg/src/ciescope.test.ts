import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { ciescopeFrame } from "./ciescope.js";
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
for (const filter of ["null", "ciescope=size=256", "ciescope=s=256"]) it(`renders two frames with ${filter}`, async () => {
  const { result, volume, error } = await run(filter);
  assert.equal(result.exitCode, 0, error);
  const hashes = ["d34e7018e0a7e932fde263ada21cc3a0", "b7f811b7bb9f71ddebe85ff86ecb45d2"];
  for (let i = 0; i < 2; i++) {
    const frame = decodeImage(volume.readFileSync(`/o${i+1}.png`) as Buffer);
    assert.equal(frame.width, filter === "null" ? 32 : 256);
    assert.equal(frame.height, filter === "null" ? 24 : 256);
    if (filter === "null") assert.deepEqual(frame.data, decodeImage(volume.readFileSync(`/f${i}.png`) as Buffer).data);
    else assert.equal(createHash("md5").update(frame.data.filter((_, j) => j % 4 !== 3)).digest("hex"), hashes[i]);
  }
  assert.equal(volume.existsSync("/o3.png"), false);
});

it("rejects unsupported ciescope options without writing output", async () => {
  const { result, volume, error } = await run("ciescope=unknown=1");
  assert.equal(result.exitCode, 1);
  assert.match(error, /ciescope: options/);
  assert.equal(volume.existsSync("/o1.png"), false);
});


for (const size of ["255", "8193", "256x256", "256.5", "NaN", ""]) {
  it(`rejects invalid ciescope size ${size}`, async () => {
    const { result, volume, error } = await run(`ciescope=size=${size}`);
    assert.equal(result.exitCode, 1);
    assert.match(error, /ciescope: size/);
    assert.equal(volume.existsSync("/o1.png"), false);
  });
}

it("uses a 512-pixel default scope", async () => {
  const { result, volume, error } = await run("ciescope");
  assert.equal(result.exitCode, 0, error);
  const frame = decodeImage(volume.readFileSync("/o1.png") as Buffer);
  assert.equal(frame.width, 512);
  assert.equal(frame.height, 512);
});

it("preserves timing and input pixels, enforces limits, and responds to cancellation", async () => {
  const input = { width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]),
    ptsSeconds: 0.2, durationSeconds: 0.2, keyframe: true };
  const output = await ciescopeFrame(input, 256, new MediaBudgetTracker());
  assert.equal(output.ptsSeconds, 0.2);
  assert.equal(output.durationSeconds, 0.2);
  assert.deepEqual(input.data, new Uint8Array([255, 0, 0, 255]));
  await assert.rejects(ciescopeFrame(input, 256, new MediaBudgetTracker(), AbortSignal.abort()));
  await assert.rejects(ciescopeFrame(input, 256, new MediaBudgetTracker({ maxMemoryBytes: 1024 })), /maxMemoryBytes/);
  await assert.rejects(ciescopeFrame(input, 256, new MediaBudgetTracker({ maxPixelsPerFrame: 1024 })), /maxPixelsPerFrame/);
});
