import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import references from "./super2xsai-reference.json" with { type: "json" };
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

// FFmpeg 9.0.1: RGB24 raw input and output, -vf super2xsai.
for (const reference of references) {
  for (const filter of ["super2xsai", "null"]) {
    it(`${reference.name}: ${filter} matches native decoded RGB pixels`, async () => {
      const { result, volume, error } = await run(filter, reference);
      assert.equal(result.exitCode, 0, error);
      const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
      const factor = filter === "null" ? 1 : 2;
      assert.equal(output.width, reference.width * factor);
      assert.equal(output.height, reference.height * factor);
      assert.deepEqual(Buffer.from(output.data.filter((_, i) => i % 4 !== 3)),
        Buffer.from(filter === "null" ? reference.rgb : reference.scaled, "hex"));
    });
  }
}
it("rejects options without writing output", async () => {
  const { result, volume } = await run("super2xsai=2");
  assert.equal(result.exitCode, 1);
  assert.equal(volume.existsSync("/out.png"), false);
});
it("checks scaled frame limits before allocating output", async () => {
  const { result, volume, error } = await run("super2xsai", references[0], { maxPixelsPerFrame: 128 });
  assert.equal(result.exitCode, 1);
  assert.ok(error.includes("maxPixelsPerFrame"), error);
  assert.equal(volume.existsSync("/out.png"), false);
});
