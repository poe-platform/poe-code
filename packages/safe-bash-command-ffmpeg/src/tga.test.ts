import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const colors = [[230, 10, 40, 255], [20, 190, 60, 127], [40, 70, 210, 0]];
const pixels = Array.from({ length: 36 }, (_, i) => colors[(Math.floor(i / 12) + Number(i % 12 > 8)) % 3]!);
function fixture(top: boolean, rle: boolean, depth = 32): Uint8Array {
  const header = new Uint8Array(18);
  header[0] = 3;
  header[2] = rle ? 10 : 2;
  header[12] = 12;
  header[14] = 3;
  header[16] = depth;
  header[17] = (top ? 32 : 0) | (depth === 32 ? 8 : 0);
  const body: number[] = [];
  for (let y = 0; y < 3; y++) {
    const row = pixels.slice((top ? y : 2 - y) * 12, (top ? y : 2 - y) * 12 + 12);
    const bgr = (p: number[]) => [p[2]!, p[1]!, p[0]!, ...(depth === 32 ? [p[3]!] : [])];
    if (rle) {
      body.push(0x88, ...bgr(row[0]!), 2, ...row.slice(9).flatMap(bgr));
    } else body.push(...row.flatMap(bgr));
  }
  return Uint8Array.from([...header, 65, 66, 67, ...body]);
}
async function convert(input: Uint8Array, existing = false) {
  const volume = new Volume();
  volume.writeFileSync("/in.tga", input);
  if (existing) volume.writeFileSync("/out.png", "keep");
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.tga", "/out.png"],
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
for (const top of [true, false]) for (const rle of [true, false]) for (const depth of [24, 32]) {
  it(`decodes TGA pixels: top=${top}, RLE=${rle}, depth=${depth}`, async () => {
    const { volume, result, stderr } = await convert(fixture(top, rle, depth));
    assert.equal(result.exitCode, 0, stderr);
    const image = decodeImage(volume.readFileSync("/out.png") as Uint8Array);
    assert.equal(image.width, 12);
    assert.equal(image.height, 3);
    assert.deepEqual([...image.data], pixels.flatMap(p => depth === 32 ? p : [...p.slice(0, 3), 255]));
  });
}
for (const rle of [true, false]) for (const length of [18, 21, 22, -1]) for (const existing of [true, false]) {
  it(`rejects truncated TGA: RLE=${rle}, length=${length}, existing=${existing}`, async () => {
    const input = fixture(true, rle);
    const { volume, result } = await convert(input.slice(0, length), existing);
    assert.notEqual(result.exitCode, 0);
    if (existing) assert.equal(volume.readFileSync("/out.png", "utf8"), "keep");
    else assert.equal(volume.existsSync("/out.png"), false);
  });
}
for (const problem of ["packet overflow", "zero width", "huge dimensions", "color map", "interleaved"]) {
  it(`rejects invalid TGA ${problem}`, async () => {
    const input = fixture(true, true);
    if (problem === "packet overflow") input[21] = 255;
    if (problem === "zero width") input[12] = 0;
    if (problem === "huge dimensions") input.fill(255, 12, 16);
    if (problem === "color map") input[1] = 1;
    if (problem === "interleaved") input[17] = input[17]! | 64;
    const { volume, result } = await convert(input);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.existsSync("/out.png"), false);
  });
}
