import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const range of ["FULL", "LIMITED", undefined]) {
  it(`decodes a ${range ?? "unspecified"} range Y4M frame to PNG`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.y4m", Buffer.concat([
      Buffer.from(`YUV4MPEG2 W4 H2 F1:1 Ip C420jpeg${range ? ` XCOLORRANGE=${range}` : ""}\nFRAME\n`),
      Buffer.from([16, 64, 128, 235, 16, 64, 128, 235, 128, 128, 128, 128])
    ]));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-frames:v", "1", "/out.png"],
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
    const png = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(png.width, 4);
    assert.equal(png.height, 2);
    const gray = range === "FULL" ? [16, 64, 128, 235] : [0, 55, 130, 255];
    assert.deepEqual([...png.data], [...gray, ...gray].flatMap(value => [value, value, value, 255]));
  });
}
