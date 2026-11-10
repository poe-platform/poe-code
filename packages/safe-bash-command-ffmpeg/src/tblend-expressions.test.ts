import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [[50, 30, 212], [120, 180, 60], [120, 180, 60], [80, 140, 190]];
const planes = (frames: number[][]) => Buffer.from(frames.flatMap(frame => frame.flatMap(value => Array<number>(4).fill(value))));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...samples.flatMap(frame => [Buffer.from("FRAME\n"), planes([frame])])]);

async function run(filter: string, source = input, format = "yuv444p", succeeds = true, graph = false, raw = false) {
  const volume = Volume.fromJSON({ "/in.y4m": source, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...(raw ? ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2", "-framerate", "4"] : []), "-i", "/in.y4m",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
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
  if (succeeds) assert.equal(result.exitCode, 0, stderr);
  else {
    assert.notEqual(result.exitCode, 0, stderr);
    assert.ok(stderr.includes("tblend:"), stderr);
    assert.equal(volume.readFileSync("/out", "utf8"), "KEEP");
  }
  assert.deepEqual(volume.readFileSync("/in.y4m"), source);
  return volume.readFileSync("/out") as Buffer;
}

// Reference bytes from Linux FFmpeg 7.0.2, including its wrapping subtraction.
for (const [expression, expected] of [
  ["all_expr=A", "78787878b4b4b4b43c3c3c3c78787878b4b4b4b43c3c3c3c505050508c8c8c8cbebebebe"],
  ["all_expr=B", "323232321e1e1e1ed4d4d4d478787878b4b4b4b43c3c3c3c78787878b4b4b4b43c3c3c3c"],
  ["c1_expr=A-B", "78787878969696963c3c3c3c78787878000000003c3c3c3c50505050d8d8d8d8bebebebe"],
  ["all_expr=X+Y", "000101020001010200010102000101020001010200010102000101020001010200010102"]
] as const) {
  for (const graph of [false, true]) it(`evaluates tblend ${expression} per pixel and component (${graph ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run(`tblend=${expression}`, input, "yuv444p", true, graph), Buffer.from(expected, "hex"));
  });
}

it("keeps expression output timestamps and one-frame latency", async () => {
  assert.deepEqual(await run("tblend=all_expr=B,select='eq(t,0.5)'"), planes([samples[1]!]));
  assert.deepEqual(await run("trim=end_frame=1,tblend=all_expr=A"), Buffer.alloc(0));
});

it("uses component expressions before the global expression and blend mode", async () => {
  assert.deepEqual(await run("tblend=all_mode=difference:all_expr=B:c1_expr=A"),
    planes([[50, 180, 212], [120, 180, 60], [120, 140, 60]]));
  assert.deepEqual(await run("tblend=all_mode=difference:c1_expr=A"),
    planes([[70, 180, 152], [0, 180, 0], [40, 140, 130]]));
  assert.deepEqual(await run("tblend=c0_mode=difference:c1_expr=A-B"),
    planes([[70, 150, 60], [0, 0, 60], [40, 216, 190]]));
  assert.deepEqual(await run("tblend=all_expr=A:all_opacity=0"), planes(samples.slice(1)));
  assert.deepEqual(await run("tblend=all_expr=B:enable='gte(n,3)'"),
    planes([samples[1]!, samples[2]!, samples[2]!]));
});

it("provides current-frame number, time, dimensions and sample aliases", async () => {
  assert.deepEqual(await run("tblend=all_expr='if(eq(TOP,A)*eq(BOTTOM,B),N+T*4+W+H+SW+SH,0)'"),
    planes([[8, 8, 8], [10, 10, 10], [12, 12, 12]]));
});

for (const [chroma, format, sx, sy, depth] of [
  ["420", "yuv420p", 2, 2, 8],
  ["422", "yuv422p", 2, 1, 8],
  ["444p10", "yuv444p10le", 1, 1, 10],
  ["444p16", "yuv444p16le", 1, 1, 16]
] as const) {
  it(`uses per-plane coordinates and unconverted samples for ${format}`, async () => {
    const widths = [3, Math.ceil(3 / sx), Math.ceil(3 / sx)];
    const heights = [3, Math.ceil(3 / sy), Math.ceil(3 / sy)];
    const size = widths.reduce((sum, width, plane) => sum + width * heights[plane]!, 0);
    const encode = (values: number[]) => {
      if (depth === 8) return Buffer.from(values);
      const bytes = Buffer.alloc(values.length * 2);
      values.forEach((value, index) => bytes.writeUInt16LE(value & 65535, index * 2));
      return bytes;
    };
    const first = Array.from({ length: size }, (_, index) => (index * 7 + 3) * (depth === 8 ? 1 : 4));
    const second = first.map(value => value + 10);
    const source = Buffer.concat([Buffer.from(`YUV4MPEG2 W3 H3 F4:1 Ip A1:1 C${chroma}\nFRAME\n`),
      encode(first), Buffer.from("FRAME\n"), encode(second)]);
    assert.deepEqual(await run("tblend=all_expr=A", source, format), encode(second));
    assert.deepEqual(await run("tblend=all_expr=B-A+0.5", source, format), encode(Array<number>(size).fill(-9)));
    assert.deepEqual(await run("tblend=all_expr='X+Y*W+W+H+SW*3+SH*3'", source, format),
      encode(widths.flatMap((width, plane) => Array.from({ length: width * heights[plane]! }, (_, pixel) =>
        pixel + 2 * width + 2 * heights[plane]!))));
  });
}

it("selects RGB components in planar GBR order and evaluates alpha expressions", async () => {
  const rgba = Buffer.from(samples.flatMap(frame => Array.from({ length: 4 }, () => [...frame, 255]).flat()));
  for (const [expression, expected] of [
    ["c0_expr=B", [[120, 30, 60, 255], [120, 180, 60, 255], [80, 180, 190, 255]]],
    ["c1_expr=B", [[120, 180, 212, 255], [120, 180, 60, 255], [80, 140, 60, 255]]],
    ["c2_expr=B", [[50, 180, 60, 255], [120, 180, 60, 255], [120, 140, 190, 255]]],
    ["c3_expr=128", [[120, 180, 60, 128], [120, 180, 60, 128], [80, 140, 190, 128]]]
  ] as const) {
    assert.deepEqual(await run(`tblend=${expression}`, rgba, "rgba", true, false, true),
      Buffer.from(expected.flatMap(frame => Array.from({ length: 4 }, () => frame).flat())));
  }
});

it("validates expressions with non-finite intermediate values and truncates fractional results", async () => {
  assert.deepEqual(await run("tblend=all_expr='if(isnan(A/B),0,255.9)'"), Buffer.alloc(36, 255));
  assert.deepEqual(await run("tblend=all_expr=0/0"), Buffer.alloc(36));
});

for (const expression of ["A+", "unknown", "if(1,A,unknown)", "", "A:c4_expr=B"]) {
  it(`rejects invalid expressions without replacing output: ${expression}`, async () => {
    await run(`tblend=all_expr=${expression}`, input, "yuv444p", false);
    await run(`trim=end_frame=1,tblend=all_expr=${expression}`, input, "yuv444p", false);
  });
}
