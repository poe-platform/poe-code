import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// RGB24 pixels from native FFmpeg 7.0.2, decoded from its PNG output.
const fixtures = [
  {
    name: "limited neutral chroma",
    header: "YUV4MPEG2 W4 H2 F25:1 Ip A1:1 C420jpeg XCOLORRANGE=LIMITED\n",
    frames: [[16, 64, 128, 235, 16, 64, 128, 235, 128, 128, 128, 128]],
    rgb: [[0, 0, 0, 55, 55, 55, 130, 130, 130, 255, 255, 255,
      0, 0, 0, 55, 55, 55, 130, 130, 130, 255, 255, 255]]
  },
  {
    name: "unspecified range with colored chroma",
    header: "YUV4MPEG2 W4 H2 F25:1 Ip A1:1 C420jpeg\n",
    frames: Array.from({ length: 3 }, (_, frame) =>
      Array.from({ length: 12 }, (_, sample) => 16 + frame * 20 + sample * 7)),
    rgb: [
      [0, 55, 0, 0, 63, 0, 0, 63, 0, 0, 71, 0, 0, 87, 0, 0, 95, 0, 0, 95, 0, 1, 104, 0],
      [0, 54, 0, 0, 62, 0, 15, 62, 0, 23, 70, 0, 19, 86, 0, 28, 95, 0, 48, 95, 13, 56, 103, 21],
      [42, 53, 13, 50, 61, 21, 69, 60, 43, 78, 69, 52, 75, 86, 46, 83, 94, 54, 102, 93, 76, 110, 101, 84]
    ]
  }
];

for (const fixture of fixtures) {
  it(`renders native Y4M RGB pixels for ${fixture.name}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.y4m", Buffer.concat([
      Buffer.from(fixture.header),
      ...fixture.frames.flatMap(frame => [Buffer.from("FRAME\n"), Buffer.from(frame)])
    ]));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-frames:v", String(fixture.frames.length), "/out%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    for (const [index, rgb] of fixture.rgb.entries()) {
      const image = decodeImage(volume.readFileSync(`/out${index + 1}.png`) as Buffer);
      assert.equal(image.width, 4);
      assert.equal(image.height, 2);
      assert.deepEqual([...image.data], rgb.flatMap((value, index) => index % 3 === 2 ? [value, 255] : [value]));
    }
  });
}
