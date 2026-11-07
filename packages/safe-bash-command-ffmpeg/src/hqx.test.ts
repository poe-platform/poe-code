import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import references from "./hqx-reference.json" with { type: "json" };
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, reference = references[0]!, limits = {}) {
  const rgb = Buffer.from(reference.rgb, "hex");
  const data = Uint8Array.from(Array.from({ length: rgb.length / 3 }, (_, i) =>
    [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, 255]).flat());
  const input = encodeImage({ width: reference.width, height: reference.height, channels: 4, data,
    format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/art.png", input);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-i", "/art.png", "-vf", filter, "/out.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}

// FFmpeg 9.0.1: raw RGB24 input, -vf hqx=n=N, raw RGB24 output.
// Compare decoded pixels, never encoded PNG bytes.
for (const reference of references) {
  for (const [filter, n] of [["hqx=n=2", 2], ["hqx=n=3", 3], ["hqx=n=4", 4],
    ["hqx=2", 2], ["hqx", 3], ["null", 1]] as const) {
    it(`${reference.name}: ${filter} matches native dimensions and every decoded RGB pixel`, async () => {
      const { result, volume, error } = await run(filter, reference);
      assert.equal(result.exitCode, 0, error);
      const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
      assert.equal(output.width, reference.width * n);
      assert.equal(output.height, reference.height * n);
      const rgb = output.data.filter((_, i) => i % 4 !== 3);
      assert.deepEqual(Buffer.from(rgb), Buffer.from(n === 1 ? reference.rgb : reference.scaled[n], "hex"));
    });
  }
}
for (const filter of ["hqx=n=1", "hqx=n=5", "hqx=n=NaN", "hqx=n=2.5", "hqx=unknown=2", "hqx=2:3"]) {
  it(`rejects ${filter} without writing output`, async () => {
    const { result, volume } = await run(filter);
    assert.equal(result.exitCode, 1);
    assert.equal(volume.existsSync("/out.png"), false);
  });
}
it("checks scaled frame limits before allocating output", async () => {
  const { result, volume, error } = await run("hqx=n=4", references[0], { maxPixelsPerFrame: 256 });
  assert.equal(result.exitCode, 1);
  assert.ok(error.includes("maxPixelsPerFrame"), error);
  assert.equal(volume.existsSync("/out.png"), false);
});
