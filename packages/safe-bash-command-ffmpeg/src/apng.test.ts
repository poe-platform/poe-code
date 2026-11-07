import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const explicit of [false, true]) {
  it(`converts all APNG frames to GIF with ${explicit ? "explicit" : "detected"} input format`, async () => {
    const volume = new Volume();
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
    const input = encodeImage({ width: 16, height: 48, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true,
      data: Uint8Array.from(colors.flatMap(color => Array.from({ length: 256 }, () => color).flat())) },
    { format: "apng", pageHeight: 16, delay: [200, 400, 200], loop: 2 }).data;
    volume.writeFileSync("/input.apng", input);
    const args = ["-v", "error", "-y", ...(explicit ? ["-f", "apng"] : []), "-i", "/input.apng", "/out.gif"];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const asyncOutput = volume.readFileSync("/out.gif") as Buffer;
    const sync = evalSyncFfmpeg(args, undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
    assert.equal(sync, "");
    assert.deepEqual(volume.readFileSync("/out.gif"), asyncOutput);
    const output = decodeImage(asyncOutput, { animated: true });
    assert.equal(output.pages, 3);
    assert.deepEqual(output.delay, [200, 400, 200]);
    assert.deepEqual(colors.map((_, i) => Array.from(output.data.subarray(i * 1024, i * 1024 + 4))), colors);
  });
}
