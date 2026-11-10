import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [[50, 30, 212], [120, 180, 60], [120, 180, 60], [80, 140, 190]];
const planes = (frames: number[][]) => Buffer.from(frames.flatMap(frame => frame.flatMap(value => Array<number>(4).fill(value))));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...samples.flatMap(frame => [Buffer.from("FRAME\n"), planes([frame])])]);

async function run(filter: string, source = input, format = "yuv444p", invalid = false, rawFormat?: string) {
  const volume = Volume.fromJSON({ "/in.y4m": source, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...(rawFormat
      ? ["-f", "rawvideo", "-pixel_format", rawFormat, "-video_size", "2x2", "-framerate", "4"] : []),
      "-i", "/in.y4m", "-vf", filter,
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
  if (invalid) {
    assert.notEqual(result.exitCode, 0, stderr);
    assert.ok(stderr.includes("tblend:"), stderr);
    assert.equal(volume.readFileSync("/out", "utf8"), "KEEP");
  } else assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(volume.readFileSync("/in.y4m"), source);
  return volume.readFileSync("/out") as Buffer;
}

// Byte-exact Linux FFmpeg 7.0.2 references.
for (const [options, expected] of [
  ["all_opacity=0", [[120, 180, 60], [120, 180, 60], [80, 140, 190]]],
  ["all_opacity=0.5", [[95, 165, 106], [60, 90, 30], [60, 90, 160]]],
  ["all_opacity=1", [[70, 150, 152], [0, 0, 0], [40, 40, 130]]],
  ["all_opacity=1/2", [[95, 165, 106], [60, 90, 30], [60, 90, 160]]],
  ["all_opacity=0.3", [[105, 171, 87], [84, 126, 42], [68, 110, 172]]],
  ["all_opacity=0.5:c1_opacity=0", [[95, 165, 106], [60, 90, 30], [60, 90, 160]]],
  ["c1_opacity=0:all_opacity=0.5", [[95, 165, 106], [60, 90, 30], [60, 90, 160]]],
  ["all_opacity=1:c1_opacity=0", [[70, 180, 152], [0, 180, 0], [40, 140, 130]]],
  ["c3_opacity=0", [[70, 150, 152], [0, 0, 0], [40, 40, 130]]],
  ["c1_opacity=0", [[70, 180, 152], [0, 180, 0], [40, 140, 130]]],
  ["c0_opacity=0:c2_opacity=0", [[120, 150, 60], [120, 0, 60], [80, 40, 190]]]
] as const) {
  it(`blends native components with ${options}`, async () => {
    assert.deepEqual(await run(`tblend=all_mode=difference:${options}`), planes(expected.map(frame => [...frame])));
  });
}

it("retains current-frame timestamps with fractional opacity", async () => {
  assert.deepEqual(await run("tblend=all_mode=difference:all_opacity=0.5,select='eq(t,0.5)'"), planes([[60, 90, 30]]));
});

for (const option of ["all_opacity=-0.1", "all_opacity=1.1", "c1_opacity=NaN", "c2_opacity=Infinity", "c0_opacity=", "c3_opacity=bogus", "c4_opacity=0"]) {
  it(`preserves existing output for invalid ${option}`, async () => {
    await run(`tblend=all_mode=difference:${option}`, input, "yuv444p", true);
  });
}

for (const [filter, expected] of [
  ["tblend=all_opacity=0", samples.slice(0, -1)],
  ["tblend=all_opacity=0.5", [[85, 105, 136], [120, 180, 60], [100, 160, 125]]]
] as const) {
  it(`applies opacity to ${filter}`, async () => {
    assert.deepEqual(await run(filter), planes(expected.map(frame => [...frame])));
  });
}

for (const [chroma, format, sx, sy, depth] of [
  ["444", "yuv444p", 1, 1, 8], ["422", "yuv422p", 2, 1, 8], ["420", "yuv420p", 2, 2, 8],
  ["444p10", "yuv444p10le", 1, 1, 10], ["444p16", "yuv444p16le", 1, 1, 16]
] as const) {
  it(`applies component opacity to ${format} with odd dimensions`, async () => {
    const chromaSize = Math.ceil(3 / sx) * Math.ceil(3 / sy);
    const first = Array.from({ length: 9 + 2 * chromaSize }, (_, i) => (i * 31 + 15) * 257 % 2 ** depth);
    const second = first.map((_, i) => (i * 79 + 240) * 257 % 2 ** depth);
    const encode = (values: number[]) => {
      if (depth === 8) return Buffer.from(values);
      const bytes = Buffer.alloc(values.length * 2);
      values.forEach((value, i) => bytes.writeUInt16LE(value, i * 2));
      return bytes;
    };
    const source = Buffer.concat([Buffer.from(`YUV4MPEG2 W3 H3 F4:1 Ip A1:1 C${chroma}\nFRAME\n`),
      encode(first), Buffer.from("FRAME\n"), encode(second)]);
    assert.deepEqual(await run("tblend=all_mode=difference:c0_opacity=0:c1_opacity=0.5", source, format),
      encode(first.map((value, i) => i < 9 ? second[i]!
        : i < 9 + chromaSize ? Math.trunc((second[i]! + Math.abs(value - second[i]!)) / 2)
        : Math.abs(value - second[i]!))));
  });
}

for (const [option, expected] of [
  ["c0_opacity=0", [[70, 180, 152], [0, 180, 0], [40, 140, 130]]],
  ["c1_opacity=0", [[70, 150, 60], [0, 0, 60], [40, 40, 190]]],
  ["c2_opacity=0", [[120, 150, 152], [120, 0, 0], [80, 40, 130]]],
  ["all_opacity=0.5", [[95, 165, 106], [60, 90, 30], [60, 90, 160]]]
] as const) {
  it(`uses planar GBR component order for RGB ${option}`, async () => {
    const packed = (frames: readonly (readonly number[])[]) => Buffer.from(frames.flatMap(frame => Array.from({ length: 4 }, () => [...frame]).flat()));
    assert.deepEqual(await run(`tblend=all_mode=difference:${option}`, packed(samples), "rgb24", false, "rgb24"), packed(expected));
  });
}

for (const [option, expectedAlpha] of [["c3_opacity=0", [128, 128, 32]], ["c3_opacity=0.5", [127, 64, 64]]] as const) {
  it(`blends the alpha component independently with ${option}`, async () => {
    const source = Buffer.from(samples.flatMap((pixel, i) =>
      [pixel[1]!, pixel[2]!, pixel[0]!, [255, 128, 128, 32][i]!].flatMap(value => Array<number>(4).fill(value))));
    const expected = Buffer.from([[70, 150, 152], [0, 0, 0], [40, 40, 130]].flatMap((pixel, i) =>
      Array.from({ length: 4 }, () => [...pixel, expectedAlpha[i]!]).flat()));
    assert.deepEqual(await run(`tblend=all_mode=difference:${option}`, source, "rgba", false, "gbrap"), expected);
  });
}

for (const [option, expected] of [
  ["all_opacity=0", [[120, 180, 60, 129], [120, 180, 60, 129], [80, 140, 190, 32]]],
  ["all_opacity=0.5", [[95, 165, 106, 127], [60, 90, 30, 64], [60, 90, 160, 64]]],
  ["c3_opacity=0", [[70, 150, 152, 129], [0, 0, 0, 129], [40, 40, 130, 32]]]
] as const) {
  it(`preserves native packed-alpha rounding with ${option}`, async () => {
    const packed = (frames: readonly (readonly number[])[]) => Buffer.from(frames.flatMap(frame => Array.from({ length: 4 }, () => [...frame]).flat()));
    const source = packed(samples.map((frame, i) => [...frame, [255, 128, 128, 32][i]!]));
    assert.deepEqual(await run(`tblend=all_mode=difference:${option}`, source, "rgba", false, "rgba"), packed(expected));
  });
}

for (const [mode, expected] of [
  ["addition", [[145, 195, 157], [180, 217, 90], [140, 197, 220]]],
  ["multiply", [[71, 100, 54], [88, 153, 37], [58, 119, 117]]]
] as const) {
  it(`mixes the calculated ${mode} result with the current sample`, async () => {
    assert.deepEqual(await run(`tblend=all_mode=${mode}:all_opacity=0.5`), planes(expected.map(frame => [...frame])));
  });
}

for (const [mode, expected] of [
  ["normal", [[85, 105, 136, 192], [120, 180, 60, 129], [100, 160, 125, 80]]],
  ["addition", [[145, 195, 157, 192], [180, 217, 90, 192], [140, 197, 220, 96]]]
] as const) {
  it(`rounds packed alpha before applying fractional ${mode} opacity`, async () => {
    const packed = (frames: readonly (readonly number[])[]) => Buffer.from(frames.flatMap(frame => Array.from({ length: 4 }, () => [...frame]).flat()));
    const source = packed(samples.map((frame, i) => [...frame, [255, 128, 128, 32][i]!]));
    assert.deepEqual(await run(`tblend=all_mode=${mode}:all_opacity=0.5`, source, "rgba", false, "rgba"), packed(expected));
  });
}

it("applies opacity only to timeline-enabled frames while retaining frame history", async () => {
  assert.deepEqual(await run("tblend=all_mode=difference:all_opacity=0.5:enable='eq(n,2)'"),
    planes([[120, 180, 60], [60, 90, 30], [80, 140, 190]]));
});
