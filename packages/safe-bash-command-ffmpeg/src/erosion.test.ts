import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { erosion } from "./erosion.js";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const gray = Buffer.from(Array.from({ length: 40 }, (_, i) => {
  const x = i % 8, y = Math.floor(i / 8);
  return x === 1 && y === 2 ? 245 : x === 6 && y === 2 ? 7 : (x < 4 ? 24 : 200) + y;
}));
const yuv = Buffer.concat([gray, Buffer.from(gray).map(value => 255 - value), Buffer.from(gray).reverse()]);

async function run(filter: string, input = gray, format = "gray", graph = false) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "8x5", "-framerate", "4", "-i", "/in.raw",
      graph ? "-filter_complex" : "-vf", graph ? `[0:v]${filter}[v]` : filter,
      ...(graph ? ["-map", "[v]"] : []), "-fps_mode", "passthrough", "-pix_fmt", format,
      "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(chunks) };
}

// Complete native FFmpeg 7.0.2 output, including all border samples.
for (const [filter, expected] of [
  ["erosion", "1818181818c8c8c8181818181807070719191919190707071a1a1a1a1a0707071b1b1b1b1bcbcbcb"],
  ["erosion=coordinates=16:threshold0=12", "18181818c8c8c8c819191919c9c9c9c91ae91a1acabe07be1b1b1b1bcbcbcbcb1c1c1c1ccccccccc"]
] as const) {
  it(`matches native ${filter} across the entire grayscale frame`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("limits erosion separately on each YUV plane in simple and complex graphs", async () => {
  for (const graph of [false, true]) {
    const result = await run("erosion=threshold0=0:threshold1=12:threshold2=0", yuv, "yuv444p", graph);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"),
      "18181818c8c8c8c819191919c9c9c9c91af51a1acaca07ca1b1b1b1bcbcbcbcb1c1c1c1ccccccccce6e6e6db36363636dadadada35353535d90ad9d93434ec34d8d8d8d833333333e3e3e3d733333333cccccccc1c1c1c1ccbcbcbcb1b1b1b1bca07caca1a1af51ac9c9c9c919191919c8c8c8c818181818");
    assert.deepEqual(result.output.subarray(0, 40), yuv.subarray(0, 40));
    assert.deepEqual(result.output.subarray(80), yuv.subarray(80));
  }
});

for (const [input, format] of [[gray, "gray"], [yuv, "yuv444p"]] as const) {
  it(`preserves the ${format} null control`, async () => {
    const result = await run("null", input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  });
}

for (const [mask, expected] of [
  [1, "0000254a6f94b9032500254a6f9413385a355a7fa42348138f6a8f0e33582348c49f1e430e33587d"],
  [2, "00254a6f94b9de0300254a6f94b91303355a7fa4c92313386a8fb40e3323486d9fc41e0e33587da2"],
  [4, "00254a6f94b90303254a6f94b9de03385a7fa4c9ee1338138fb4d90e23486d48c4e90e33587da27d"],
  [8, "0000254a6f94b90335355a7fa4c913136a6a8fb4d92323489f9fc40e0e33587dd4d41e1e43688db2"],
  [16, "00254a6f94b90303355a7fa4c91313136a8fb4d9232348489fc40e0e33587d7dd41e1e43688db2b2"],
  [32, "00254a6f94b9de03355a7fa4c9ee13386a8fb4d90e23486d9fc4e90e33587da2d4d41e1e43688db2"],
  [64, "00254a6f94b91303355a7fa4c92313386a8fb40e3323486d9fc41e0e33587da2d4f91e43688db2d7"],
  [128, "00254a6f94133803355a7fa4234813386a8f0e335823486d9f1e430e33587da2d41e1e43688db2b2"]
] as const) {
  it(`matches native borders for coordinate bit ${mask}`, async () => {
    const input = Buffer.from(Array.from({ length: 40 }, (_, i) => (i * 37 + Math.floor(i / 8) * 13) % 256));
    const result = await run(`erosion=coordinates=${mask}`, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("preserves disabled frames and planes and accepts positional expressions", async () => {
  for (const filter of ["erosion=coordinates=0", "erosion=threshold0=0:threshold1=0:threshold2=0", "erosion=enable=0"]) {
    const result = await run(filter, yuv, "yuv444p");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, yuv);
  }
  const result = await run("erosion=2^4:12.5:default:default:default:enable='eq(t,0.25)'", Buffer.concat([gray, gray, gray]));
  assert.equal(result.exitCode, 0, result.stderr);
  const expected = Buffer.from("18181818c8c8c8c819191919c9c9c9c91ae91a1acabe07be1b1b1b1bcbcbcbcb1c1c1c1ccccccccc", "hex");
  assert.deepEqual(result.output, Buffer.concat([gray, expected, gray]));
});

for (const option of ["coordinates=-1", "coordinates=256", "threshold0=-1", "threshold1=65536", "threshold2=nan", "threshold3=inf", "threshold0=", "unknown=1", "1:2:3:4:5:6"]) {
  it(`rejects invalid erosion option ${option} without output`, async () => {
    const result = await run(`erosion=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("erosion"), result.stderr);
    assert.equal(result.output.length, 0);
  });
}

it("accounts for output memory, preserves input and metadata, and observes cancellation", async () => {
  const data = Uint8Array.from(Array.from(gray).flatMap(value => [value, value, value, 255]));
  const original = data.slice();
  const frame = { data, width: 8, height: 5, ptsSeconds: 1, durationSeconds: 0.25, keyframe: true };
  await assert.rejects(erosion([frame], "", "gray", new MediaBudgetTracker({ maxMemoryBytes: data.length - 1 })), /maxMemoryBytes/);
  const budget = new MediaBudgetTracker();
  const [filtered] = await erosion([frame], "", "gray", budget);
  const expected = Buffer.from("1818181818c8c8c8181818181807070719191919190707071a1a1a1a1a0707071b1b1b1b1bcbcbcb", "hex");
  assert.deepEqual(filtered, { ...frame, data: Uint8Array.from(Array.from(expected).flatMap(value => [value, value, value, 255])) });
  assert.deepEqual(data, original);
  assert.equal(budget.getStats().currentMemoryBytes, data.length);
  const controller = new AbortController();
  const filtering = erosion([frame], "", "gray", new MediaBudgetTracker(), controller.signal);
  controller.abort(new Error("stop erosion"));
  await assert.rejects(filtering, /stop erosion/);
});

for (const [format, length, hash] of [
  ["yuv420p", 64, "a92c579d74dd91c70dce48559f054b1a3c45adfcf54253792b096e3a29c0a7e8"],
  ["yuv422p", 80, "a19d01e1e9b6ba3d9e6576d821e2b1dcf4ebc0ae84fb8aaead6c3da2ed0034e6"],
  ["yuv444p", 120, "f9c49a88fb143d9be16e828e063997658429607353416193cd4272bb016e106c"]
] as const) {
  it(`matches native masks and independent thresholds on odd-height ${format}`, async () => {
    const input = Buffer.from(Array.from({ length }, (_, i) => (i * 37 + Math.floor(i / 8) * 13) % 256));
    const result = await run("erosion=coordinates=165:threshold0=7:threshold1=33:threshold2=129", input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}
