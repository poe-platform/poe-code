import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const source of [
  "color=red:4x4:r=1:d=1",
  "color=red:s=4x4:r=1:d=1",
  "color=c=red:s=4x4:r=1:d=1",
  "color=red:4x4:1:1"
]) {
  it(`exports the same 4x4 red PNG for ${source}`, async () => {
    const bytes = await run(Volume.fromJSON({}), ["-v", "error", "-f", "lavfi", "-i", source,
      "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"]);
    const image = decodeImage(bytes);
    assert.equal(image.width, 4);
    assert.equal(image.height, 4);
    assert.deepEqual([...image.data], Array.from({ length: 16 }, () => [253, 0, 0, 255]).flat());
  });
}

it("uses positional color source rate and duration", async () => {
  const volume = Volume.fromJSON({});
  await run(volume, ["-v", "error", "-f", "lavfi", "-i", "color=red:4x4:2:1", "/o%d.png"]);
  assert.deepEqual(volume.readdirSync("/"), ["o1.png", "o2.png"]);
});

it("matches FFmpeg 7.0.2 default lavfi red RGB PNG samples in both frames", async () => {
  const volume = Volume.fromJSON({});
  await run(volume, ["-y", "-v", "error", "-f", "lavfi", "-i",
    "color=c=red:size=96x64:rate=2:duration=1", "/o%d.png"]);
  for (const path of ["/o1.png", "/o2.png"]) {
    const image = decodeImage(volume.readFileSync(path) as Buffer);
    assert.equal(image.width, 96);
    assert.equal(image.height, 64);
    const rgb = image.data.filter((_, index) => index % 4 !== 3);
    assert.equal(createHash("md5").update(rgb).digest("hex"), "1effe60fa375b3c22f7980fbc01dc77a");
  }
  assert.equal(volume.existsSync("/o3.png"), false);
});

// FFmpeg 7's default limited-range BT.601 source and x86 RGB conversion.
for (const [options, pixel] of [
  ["", "000000ff"], ["c=black:", "000000ff"], ["c=blue:", "0000feff"]
] as const) {
  it(`matches native RGBA stdout for color=${options}s=4x4:r=1:d=1`, async () => {
    const output = await run(Volume.fromJSON({}), [
      "-v", "error", "-f", "lavfi", "-i", `color=${options}s=4x4:r=1:d=1`,
      "-frames:v", "1", "-c:v", "rawvideo", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"
    ]);
    assert.deepEqual(output, Buffer.from(pixel.repeat(16), "hex"));
  });
}

for (const [color, expected] of [
  ["0xff0000", [253, 0, 0]], ["blue", [0, 0, 254]],
  ["green", [0, 127, 0]], ["white", [255, 255, 255]], ["black", [0, 0, 0]]
] as const) {
  it(`converts lavfi ${color} through the default source format`, async () => {
    const volume = Volume.fromJSON({});
    await run(volume, ["-f", "lavfi", "-i", `color=c=${color}:s=96x64:r=1:d=1`, "/out.png"]);
    const image = decodeImage(volume.readFileSync("/out.png") as Buffer);
    for (let offset = 0; offset < image.data.length; offset += 4) {
      assert.deepEqual([...image.data.subarray(offset, offset + 3)], expected);
    }
  });
}

it("preserves exact RGB samples when copying an existing red PNG", async () => {
  const data = new Uint8Array(96 * 64 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
  const input = encodeImage({ width: 96, height: 64, data, format: "png", space: "srgb",
    channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
  const volume = Volume.fromJSON({ "/in.png": Buffer.from(input) });
  for (const options of [[], ["-c:v", "copy"]]) {
    await run(volume, ["-y", "-i", "/in.png", ...options, "/out.png"]);
    assert.deepEqual(decodeImage(volume.readFileSync("/out.png") as Buffer).data, data);
  }
});

async function run(volume: Volume, args: string[]) {
  let stderr = "";
  const stdout: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(stdout);
}
