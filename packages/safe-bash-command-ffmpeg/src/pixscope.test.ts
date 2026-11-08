import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, type FfmpegCommandsOptions } from "./index.js";

async function render(filter: string, limits?: FfmpegCommandsOptions["limits"], scaled = false) {
  const volume = new Volume();
  for (let t = 0; t < 2; t++) {
    const data = new Uint8Array(32 * 24 * 4);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
      data.set([(7*x + 3*y + 87*t) % 256, (2*x + 9*y + 53*t) % 256,
        (4*x + 11*y + 23*t) % 256, 255], (y*32+x)*4);
    }
    volume.writeFileSync(`/f${t}.png`, encodeImage({ width: 32, height: 24, data,
      format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72,
      hasAlpha: false }, { format: "png" }).data);
  }
  if (scaled) for (let t = 0; t < 2; t++) {
    volume.writeFileSync(`/f${t}.png`, readFileSync(new URL(`./fixtures/pixscope/scaled${t+1}.png`, import.meta.url)));
  }
  volume.writeFileSync("/o1.png", "keep");
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-y", "-framerate", "5", "-i", "/f%d.png", "-vf", filter, "/o%d.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { volume, result, stderr: Buffer.concat(errors).toString() };
}

it("pixscope matches native RGB analysis on both scaled frames", async () => {
  const { volume, result, stderr } = await render("pixscope", undefined, true);
  assert.equal(result.exitCode, 0, stderr);
  const hashes = ["e1154d026710744ec832e646ef7a9fa5", "01b8dc1e3b79eaee36e96958f8799007"];
  for (let i = 0; i < 2; i++) {
    const output = decodeImage(volume.readFileSync(`/o${i+1}.png`) as Buffer);
    assert.equal(output.width, 640);
    assert.equal(output.height, 480);
    assert.equal(createHash("md5").update(output.data.filter((_, index) => index % 4 !== 3)).digest("hex"), hashes[i]);
  }
  assert.equal(volume.existsSync("/o3.png"), false);
});

for (const [filter, limits, error] of [
  ["pixscope", undefined, "640x480"],
  ["scale=640:480,pixscope=x=0", undefined, "options"],
  ["scale=640:480,pixscope", { maxMemoryBytes: 100000 }, "maxMemoryBytes"]
] as const) {
  it(`pixscope preserves output on rejection: ${filter} ${error}`, async () => {
    const { volume, result, stderr } = await render(filter, limits);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes(error), stderr);
    assert.equal(volume.readFileSync("/o1.png", "utf8"), "keep");
    assert.equal(volume.existsSync("/o2.png"), false);
  });
}

it("scale followed by pixscope emits two distinct frames", async () => {
  const { volume, result, stderr } = await render("scale=640:480,pixscope");
  assert.equal(result.exitCode, 0, stderr);
  const first = decodeImage(volume.readFileSync("/o1.png") as Buffer);
  const second = decodeImage(volume.readFileSync("/o2.png") as Buffer);
  assert.equal(first.width, 640); assert.equal(first.height, 480);
  assert.equal(second.width, 640); assert.equal(second.height, 480);
  assert.notDeepEqual(first.data, second.data);
  assert.equal(volume.existsSync("/o3.png"), false);
});
