import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import { kirsch } from "./kirsch.js";

const gray = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  35 + 30 * Number(i % 16 >= 4) + 100 * Number(i % 16 >= 9) + 35 * Number(i >= 128)));
const yuv = Buffer.from(Array.from({ length: 768 }, (_, i) => {
  const plane = Math.floor(i / 256);
  return 30 + 12 * plane + 35 * Number(i % 16 >= 3 + plane) + 75 * Number(Math.floor(i % 256 / 16) >= 8 - plane);
}));

async function run(filter: string, input = gray, format = "gray", graph = false) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "16x16", "-framerate", "4", "-i", "/in.raw",
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

// Complete rawvideo references from native FFmpeg 7.0.2.
for (const [filter, hash, row] of [
  ["kirsch", "f7f0f6dd0f68c4c0e3124e73b98f36cd85122818cb455d0e23ae9c8712d64a2a", Array(16).fill(255)],
  ["kirsch=scale=0.25:delta=16", "c9c4d53540a86305fa9c030a54073f2d3eee8b9e25d1671179ae601a0665855e",
    [147, 147, 147, 139, 154, 147, 147, 147, 122, 172, 147, 147, 147, 147, 147, 147]]
] as const) {
  it(`matches native grayscale ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 256);
    assert.deepEqual([...result.output.subarray(112, 128)], row);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

it("filters only the selected YUV plane through simple and complex graphs", async () => {
  for (const graph of [false, true]) {
    const result = await run("kirsch=planes=2:scale=0.25:delta=16", yuv, "yuv444p", graph);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 768);
    assert.deepEqual(result.output.subarray(0, 256), yuv.subarray(0, 256));
    assert.deepEqual(result.output.subarray(512), yuv.subarray(512));
    assert.equal(createHash("sha256").update(result.output).digest("hex"),
      "6e933acff3ffc74d0a454fdd4e2b7e03018804ebef061a136d0c907f7a814fbc");
  }
});

for (const [input, format] of [[gray, "gray"], [yuv, "yuv444p"]] as const) {
  for (const filter of ["null", "kirsch=planes=0", "kirsch=enable=0"]) {
    it(`preserves ${format} for ${filter}`, async () => {
      const result = await run(filter, input, format);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, input);
    });
  }
}

it("accepts positional numeric expressions and preserves frame timing for enable", async () => {
  const filtered = await run("kirsch=15:1/4:16");
  assert.equal(filtered.exitCode, 0, filtered.stderr);
  const named = await run("kirsch=scale=0.25:delta=16");
  assert.deepEqual(filtered.output, named.output);
  const result = await run("kirsch=15:1/4:16:enable='eq(t,0.25)'", Buffer.concat([gray, gray, gray]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([gray, filtered.output, gray]));
});

for (const option of ["planes=-1", "planes=16", "scale=-1", "scale=65536", "delta=-65536", "delta=65536", "scale=nan", "scale=", "unknown=1", "15:1:0:2"]) {
  it(`rejects invalid kirsch option ${option} before emitting output`, async () => {
    const result = await run(`kirsch=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("kirsch"), result.stderr);
    assert.equal(result.output.length, 0);
  });
}

// Native references exercise every border, fractional truncation, and chroma dimensions.
for (const [format, count, hash] of [
  ["gray", 256, "ab689fca745856c20f98bcb62dd19449ed812d10f693ecf1ca7f1c5ed0a51a09"],
  ["yuv420p", 384, "00ca0e88481be77ad5b07015ea55c20cc02a2c7b3d69097cf1d26cfa17c5f09f"],
  ["yuv422p", 512, "b651e1b43a952f2c54d0e313ce9d76b1f9cad7811b6a5428fb13172462de6a84"],
  ["yuv444p", 768, "234bc321900d36f4c754f4d87c69a4690f3b047c9c8a43ac4f3172eef47a914b"]
] as const) {
  it(`matches native border handling and clipping for ${format}`, async () => {
    const input = Buffer.from(Array.from({ length: count }, (_, i) => (i * 37 + Math.floor(i / 16) * 13) % 256));
    const result = await run(format === "gray" ? "kirsch=scale=0.125:delta=-16.5"
      : "kirsch=planes=2:scale=0.125:delta=16.5", input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    if (format !== "gray") {
      assert.deepEqual(result.output.subarray(0, 256), input.subarray(0, 256));
      assert.deepEqual(result.output.subarray(256 + (count - 256) / 2), input.subarray(256 + (count - 256) / 2));
    }
  });
}

it("bounds allocations, preserves frame metadata and input, and checks cancellation", async () => {
  const data = new Uint8Array(16 * 16 * 4).fill(80);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const original = data.slice();
  const frame = { data, width: 16, height: 16, ptsSeconds: 1, durationSeconds: 0.25, keyframe: true };
  await assert.rejects(kirsch([frame], "", "gray", new MediaBudgetTracker({ maxMemoryBytes: data.length - 1 })), /maxMemoryBytes/);
  const budget = new MediaBudgetTracker();
  const [filtered] = await kirsch([frame], "delta=16", "gray", budget);
  assert.deepEqual(filtered, { ...frame, data: Uint8Array.from({ length: data.length }, (_, i) => i % 4 === 3 ? 255 : 16) });
  assert.deepEqual(data, original);
  assert.equal(budget.getStats().currentMemoryBytes, data.length);
  const controller = new AbortController();
  const rendering = kirsch([frame], "", "gray", new MediaBudgetTracker(), controller.signal);
  controller.abort(new Error("stop kirsch"));
  await assert.rejects(rendering, /stop kirsch/);
});
