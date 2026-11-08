import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import reference from "./xbr-reference.json" with { type: "json" };
import { createFfmpegCommand } from "./index.js";

const palette = reference.palette as Record<string, number[]>;
const pixels = (rows: string[]) => Uint8Array.from([...rows.join("")].flatMap(c => [...palette[c]!, 255]));
const input = encodeImage({ width: 8, height: 8, channels: 4, data: pixels(reference.rows),
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;

async function run(filter: string, limits = {}) {
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

// Decoded RGB references generated with FFmpeg 9.0.1 from the issue's 8x8 art.
for (const [filter, n] of [["xbr=n=2", 2], ["xbr=n=3", 3], ["xbr=n=4", 4], ["xbr=2", 2], ["xbr", 3], ["null", 1]] as const) {
  it(`${filter} matches native dimensions and every decoded pixel`, async () => {
    const { result, volume, error } = await run(filter);
    assert.equal(result.exitCode, 0, error);
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(output.width, 8 * n);
    assert.equal(output.height, 8 * n);
    const rgb = output.data.filter((_, index) => index % 4 !== 3);
    const expected = n === 1 ? pixels(reference.rows).filter((_, index) => index % 4 !== 3) : Uint8Array.from(Buffer.from(reference.references[n], "hex"));
    assert.deepEqual(rgb, expected);
  });
}
for (const filter of ["xbr=n=1", "xbr=n=5", "xbr=n=2.5", "xbr=n=NaN", "xbr=unknown=2", "xbr=2:3"]) {
  it(`rejects ${filter} without writing output`, async () => {
    const { result, volume } = await run(filter);
    assert.equal(result.exitCode, 1);
    assert.equal(volume.existsSync("/out.png"), false);
  });
}
it("checks scaled frame limits before allocating output", async () => {
  const { result, volume, error } = await run("xbr=n=3", { maxPixelsPerFrame: 256 });
  assert.equal(result.exitCode, 1);
  assert.ok(error.includes("maxPixelsPerFrame"), error);
  assert.equal(volume.existsSync("/out.png"), false);
});
