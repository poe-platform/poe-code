import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [size, width, height] of [
  ["iw+2:ih+2", 11, 8], ["2*iw:2*ih", 18, 12],
  ["oh*2:6", 12, 6], ["12:ow/2", 12, 6],
  ["out_h*2:6", 12, 6], ["12:out_w/2", 12, 6],
  ["(in_w+3)*2:(in_h+2)/2", 24, 4], ["12:8", 12, 8],
  ["oh*2+1:6.9", 13, 6],
  ["iw+2junk:6", 0, 0], ["oh*2:ow/2", 0, 0], ["12:ih+", 0, 0]
] as const) {
  it(`evaluates dimensions and matches literal-scale pixels for scale=${size}`, async () => {
    const pixels = Uint8Array.from(Array.from({ length: 54 }, (_, i) => [(i + 1) * 4, (i + 1) * 4, (i + 1) * 4, 255]).flat());
    const input = encodeImage({ width: 9, height: 6, data: pixels, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", input);
    const errors: Uint8Array[] = [];
    const context = {
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    };
    const command = createFfmpegCommand();
    const result = await command.execute({ ...context, args: ["-i", "/in.png", "-vf", `scale=${size}`, "-frames:v", "1", "/out.png"] } as never);
    if (width === 0) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes("scale:"));
      assert.equal(volume.existsSync("/out.png"), false);
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(output.width, width);
    assert.equal(output.height, height);
    // Native FFmpeg RGBA output for the same 9x6 grayscale input.
    const hashes: Record<string, string> = {
      "iw+2:ih+2": "508b72d19e52cb3cc146ee26bd787b535ca2b09cebd419d1e4c2952c92ef968d",
      "2*iw:2*ih": "caef008374a87751cddf5bff85f74cdd2f8c889d6b7ed3123d7df5c34f701013",
      "oh*2:6": "6aa68e1ad1ccbf558359a9f4dfbf083bc9b9831b28db237b8b565943b6190007",
      "12:ow/2": "6aa68e1ad1ccbf558359a9f4dfbf083bc9b9831b28db237b8b565943b6190007"
    };
    if (hashes[size]) assert.equal(createHash("sha256").update(output.data).digest("hex"), hashes[size]);
    const reference = await command.execute({ ...context, args: ["-i", "/in.png", "-vf", `scale=${width}:${height}`, "-frames:v", "1", "/reference.png"] } as never);
    assert.equal(reference.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(output.data, decodeImage(volume.readFileSync("/reference.png") as Buffer).data);
  });
}
