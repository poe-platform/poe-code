import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, filter: string, format = "yuv444p") {
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

const frames = Array.from({ length: 6 }, (_, i) => Buffer.from([
  ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(32 + 24 * i + 3 * y)).flat(),
  ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(35 + 9 * i + y)).flat(),
  ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(216 - 8 * i - y)).flat()
]));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
  ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);

// Native Linux FFmpeg 7.0.2, including the unfiltered control.
for (const [filter, length, hash] of [
  ["null", 288, "d1ab175685096bb648e5d2cef5f67c15f51417f14c86833abead268fa6081999"],
  ["tinterlace=4", 144, "616db2babbab6c199900ab2190c73a4d3840f8642b486ee453e2cd8cacefa812"],
  ["tinterlace=mode=interleave_top", 144, "616db2babbab6c199900ab2190c73a4d3840f8642b486ee453e2cd8cacefa812"]
] as const) {
  it(`preserves native YUV444 samples with ${filter}`, async () => {
    const output = await run(input, filter);
    assert.equal(output.length, length);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const [chroma, format, hsub, vsub, depth] of [
  ["444", "yuv444p", 1, 1, 8],
  ["422", "yuv422p", 2, 1, 8],
  ["420jpeg", "yuv420p", 2, 2, 8],
  ["444p10", "yuv444p10le", 1, 1, 10],
  ["444p16", "yuv444p16le", 1, 1, 16]
] as const) {
  it(`weaves each ${format} plane independently and drops an unmatched frame`, async () => {
    const framePlanes = Array.from({ length: 3 }, (_, f) => Array.from({ length: 3 }, (_, p) => {
      const width = p === 0 ? 4 : 4 / hsub;
      const height = p === 0 ? 4 : 4 / vsub;
      const data = Buffer.alloc(width * height * (depth === 8 ? 1 : 2));
      for (let i = 0; i < width * height; i++) {
        const sample = (30 + f * 25 + p * 60 + i) * 2 ** (depth - 8) + (depth === 8 ? 0 : 3);
        if (depth === 8) data[i] = sample;
        else data.writeUInt16LE(sample, i * 2);
      }
      return data;
    }));
    const source = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C${chroma}\n`),
      ...framePlanes.flatMap(planes => [Buffer.from("FRAME\n"), ...planes])]);
    const expected = Buffer.concat(framePlanes[0]!.map((plane, p) => {
      const height = p === 0 ? 4 : 4 / vsub;
      const stride = plane.length / height;
      return Buffer.concat(Array.from({ length: height }, (_, row) =>
        framePlanes[row % 2]![p]!.subarray(row * stride, (row + 1) * stride)));
    }));
    assert.deepEqual(await run(source, "tinterlace=interleave_top", format), expected);

    // Downstream RGB consumers must render the woven chroma, including 4:2:0.
    const woven = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F3:1 It A1:1 C${chroma}\nFRAME\n`), expected]);
    assert.deepEqual(await run(source, "tinterlace=4,format=rgba", "rgba"), await run(woven, "scale=iw:ih,format=rgba", "rgba"));
  });
}

it("does not reuse stale source planes after RGB filtering", async () => {
  const source = await run(input, "format=rgba,negate,format=yuv444p", "yuv444p");
  const converted = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
    ...Array.from({ length: 6 }, (_, i) => [Buffer.from("FRAME\n"), source.subarray(i * 48, (i + 1) * 48)]).flat()]);
  // Explicitly return to YUV before weaving so both paths negotiate the same format.
  assert.deepEqual(await run(input, "format=rgba,negate,format=yuv444p,tinterlace=4"),
    await run(converted, "tinterlace=4"));
});

it("weaves modified RGB rows after native planes are invalidated", async () => {
  const source = await run(input, "format=rgba,negate", "rgba");
  const expected = Buffer.concat(Array.from({ length: 3 }, (_, pair) =>
    Array.from({ length: 4 }, (_, row) => {
      const start = (pair * 2 + row % 2) * 64 + row * 16;
      return source.subarray(start, start + 16);
    })).flat());
  assert.deepEqual(await run(input, "format=rgba,negate,tinterlace=4", "rgba"), expected);
});
