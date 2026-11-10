import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, filter: string, format: string) {
  const volume = Volume.fromJSON({ "/in.y4m": Buffer.from(input), "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out") as Buffer;
}

function fixture(chroma: string, width = 4, height = 4, gray = false) {
  const sx = chroma.startsWith("444") ? 1 : 2;
  const sy = chroma === "420" ? 2 : 1;
  const depth = chroma === "444p10" ? 10 : chroma === "444p16" ? 16 : 8;
  const planes = Array.from({ length: 6 }, (_, frame) => Array.from({ length: 3 }, (_, plane) =>
    Array.from({ length: Math.ceil(height / (plane === 0 ? 1 : sy)) }, (_, row) => {
      const value = plane === 0 ? 32 + 24 * frame + 3 * row : gray ? 128
        : plane === 1 ? 35 + 9 * frame + row : 216 - 8 * frame - row;
      const samples = Math.ceil(width / (plane === 0 ? 1 : sx));
      if (depth === 8) return Buffer.alloc(samples, value);
      const bytes = Buffer.alloc(samples * 2);
      for (let x = 0; x < samples; x++) bytes.writeUInt16LE((value << (depth - 8)) + frame + row, x * 2);
      return bytes;
    })));
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F6:1 Ip A1:1 C${chroma}\n`);
  return { planes, header, input: Buffer.concat([header, ...planes.flatMap(frame => [Buffer.from("FRAME\n"), ...frame.flat()])]) };
}

// Captured from Linux FFmpeg 7.0.2 for the 4x4 color fixture.
for (const [filter, length, hash] of [
  ["telecine=pattern=23", 336, "cd4788ea177180770c7b9d7459b79aa8a5e2f92ae7c2146789063056dd5b0389"],
  ["telecine=pattern=22", 288, "d1ab175685096bb648e5d2cef5f67c15f51417f14c86833abead268fa6081999"],
  ["null", 288, "d1ab175685096bb648e5d2cef5f67c15f51417f14c86833abead268fa6081999"]
] as const) {
  it(`matches native YUV444 bytes with ${filter}`, async () => {
    const output = await run(fixture("444").input, filter, "yuv444p");
    assert.equal(output.length, length);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

const cadence = [[0, 0], [1, 1], [1, 2], [2, 3], [3, 3], [4, 4], [5, 5]];
for (const chroma of ["444", "422", "420", "444p10", "444p16"]) {
  for (const field of ["top", "bottom"]) {
    it(`weaves ${chroma} plane rows in ${field}-first order without losing samples`, async () => {
      const { input, planes } = fixture(chroma, 5, 6);
      const expected = cadence.flatMap(pair => planes[0]!.flatMap((rows, plane) => rows.map((_, row) =>
        planes[pair[(row + (field === "bottom" ? 1 : 0)) % 2]!]![plane]![row]!)));
      const format = `yuv${chroma.includes("p") ? `${chroma}le` : `${chroma}p`}`;
      assert.deepEqual(await run(input, `telecine=first_field=${field}:pattern=23`, format), Buffer.concat(expected));
    });
  }
}

it("preserves grayscale luma in mixed fields", async () => {
  const { input, planes } = fixture("444", 4, 4, true);
  const expected = cadence.flatMap(pair => planes[0]!.flatMap((rows, plane) => rows.map((_, row) =>
    planes[pair[row % 2]!]![plane]![row]!)));
  assert.deepEqual(await run(input, "telecine", "yuv444p"), Buffer.concat(expected));
});

it("renders woven subsampled planes for downstream RGB filters", async () => {
  const { input, header, planes } = fixture("420");
  const woven = Buffer.concat([header, ...cadence.flatMap(pair => [Buffer.from("FRAME\n"),
    ...planes[0]!.flatMap((rows, plane) => rows.map((_, row) => planes[pair[row % 2]!]![plane]![row]!))])]);
  const actual = await run(input, "telecine,format=rgba,negate", "rgba");
  // Tiling renders native planes through the codec, whereas Y4M decoding uses its own RGB conversion.
  const expected = await run(woven, "tile=1x1,format=rgba,negate", "rgba");
  assert.equal(actual.length, expected.length);
  for (const frame of [2, 3]) {
    assert.deepEqual(actual.subarray(frame * 64, (frame + 1) * 64), expected.subarray(frame * 64, (frame + 1) * 64));
  }
});
