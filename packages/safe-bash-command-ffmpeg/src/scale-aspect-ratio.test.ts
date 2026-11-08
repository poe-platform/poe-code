import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [mode, width, height] of [
  ["decrease", 10, 7], ["increase", 15, 10], ["disable", 10, 10],
  ["1", 10, 7], ["2", 15, 10], ["0", 10, 10], [undefined, 10, 10]
] as const) {
  it(`scale force_original_aspect_ratio=${mode} preserves expected dimensions and pixels`, async () => {
    const data = Uint8Array.from(Array.from({ length: 54 }, (_, i) => [(i + 1) * 4, (i + 1) * 4, (i + 1) * 4, 255]).flat());
    const input = encodeImage({ width: 9, height: 6, data, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", input);
    const errors: Uint8Array[] = [];
    const run = (filter: string, output: string) => createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.png", "-vf", filter, "-frames:v", "1", output],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const filter = `scale=10:10${mode === undefined ? "" : `:force_original_aspect_ratio=${mode}`}`;
    assert.equal((await run(filter, "/out.png")).exitCode, 0, Buffer.concat(errors).toString());
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(output.width, width);
    assert.equal(output.height, height);
    assert.equal((await run(`scale=${width}:${height}`, "/expected.png")).exitCode, 0);
    assert.deepEqual(output.data, decodeImage(volume.readFileSync("/expected.png") as Buffer).data);
    const previous = volume.readFileSync("/out.png");
    assert.notEqual((await run("scale=10:10:force_original_aspect_ratio=bogus", "/out.png")).exitCode, 0);
    assert.deepEqual(volume.readFileSync("/out.png"), previous);
  });
}
