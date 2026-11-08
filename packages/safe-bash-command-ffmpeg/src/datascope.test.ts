import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, type FfmpegCommandsOptions } from "./index.js";

async function render(filter: string, limits?: FfmpegCommandsOptions["limits"]) {
  const volume = new Volume();
  for (let t = 0; t < 2; t++) {
    const data = new Uint8Array(32 * 24 * 4);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
      data.set([(7*x + 3*y + 87*t) % 256, (2*x + 9*y + 53*t) % 256,
        (4*x + 11*y + 23*t) % 256, 255], (y*32+x)*4);
    }
    volume.writeFileSync(`/f${t}.png`, encodeImage({ width: 32, height: 24, data,
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72,
      hasAlpha: false }, { format: "png" }).data);
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

for (const size of ["size=320x240", "s=320x240", "320x240"]) {
  it(`datascope ${size} matches native RGB readouts for each frame`, async () => {
    const { volume, result, stderr } = await render(`datascope=${size}`);
    assert.equal(result.exitCode, 0, stderr);
    const hashes = ["99d7e00c923dc6c82ebd2825f6ea4dd5", "387e90a59381fd1f89acb2fa317bb21e"];
    for (let i = 0; i < 2; i++) {
      const output = decodeImage(volume.readFileSync(`/o${i+1}.png`) as Buffer);
      assert.equal(output.width, 320);
      assert.equal(output.height, 240);
      assert.equal(createHash("md5").update(output.data.filter((_, index) => index % 4 !== 3)).digest("hex"), hashes[i]);
    }
    assert.equal(volume.existsSync("/o3.png"), false);
  });
}

it("datascope defaults to 1280x720 and retains frame cadence", async () => {
  const { volume, result, stderr } = await render("datascope");
  assert.equal(result.exitCode, 0, stderr);
  for (let i = 1; i <= 2; i++) {
    const frame = decodeImage(volume.readFileSync(`/o${i}.png`) as Buffer);
    assert.equal(frame.width, 1280);
    assert.equal(frame.height, 720);
  }
  assert.equal(volume.existsSync("/o3.png"), false);
});

for (const [filter, limits, error] of [
  ["datascope=size=0x240", undefined, "datascope:"],
  ["datascope=size=320xno", undefined, "datascope:"],
  ["datascope=mode=color", undefined, "datascope:"],
  ["datascope=320x240:unknown=1", undefined, "datascope:"],
  ["datascope=320x240", { maxPixelsPerFrame: 1024 }, "maxPixelsPerFrame"],
  ["datascope=320x240", { maxMemoryBytes: 100000 }, "maxMemoryBytes"]
] as const) {
  it(`datascope preserves output on rejection: ${filter} ${error}`, async () => {
    const { volume, result, stderr } = await render(filter, limits);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes(error), stderr);
    assert.equal(volume.readFileSync("/o1.png", "utf8"), "keep");
    assert.equal(volume.existsSync("/o2.png"), false);
  });
}
