import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { edgedetect } from "./edgedetect.js";
import { createFfmpegCommand } from "./index.js";

const gray = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  35 + 30 * Number(i % 16 >= 4) + 100 * Number(i % 16 >= 9) + 35 * Number(Math.floor(i / 16) >= 8)));
const rgb = Buffer.from(Array.from({ length: 256 }, (_, i) => [
  20 + 150 * Number(i % 16 >= 8), 40 + 110 * Number(Math.floor(i / 16) >= 8),
  25 + 120 * Number(i % 16 + Math.floor(i / 16) >= 15)
]).flat());

async function render(filter: string, format = "gray", input = format === "gray" ? gray : rgb, graph = false) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "16x16", "-framerate", "4", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { result, stderr, output: Buffer.concat(stdout) };
}

// Full-output hashes captured with FFmpeg 7.0.2-static, including the null controls.
for (const [filter, format, hash] of [
  ["null", "gray", "e0f4379e4b087c0e78cd7d80564fd8f5179b43190156edb3e3c9d2f2c2d343c1"],
  ["edgedetect", "gray", "845c8e3b813ecaa6990b460ebb91a0e11b3cbe91beca0cd3ebcc7539c8f4a0f6"],
  ["edgedetect=low=0.3:high=0.6", "gray", "e464079687f02957ec601e87c3a6c66668960ed0242e356dd915b154189c96a9"],
  ["null", "rgb24", "141ff10e8059c036f017b58aabed40d6859452e6f4ccaf248b4487703330a22a"],
  ["edgedetect=mode=colormix", "rgb24", "8226b478f240833ebfcaf1ee245b60f431b8bd3a6b4893d85b4a245e15de8a14"],
  ["edgedetect=mode=canny:planes=r", "rgb24", "87e7f0a527fb086afa3c005a56def4f410c16b13f414eecb248280d738dc4fb7"]
]) {
  for (const graph of [false, true]) {
    it(`${filter} on ${format} matches native output (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await render(filter!, format!, undefined, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, format === "gray" ? 256 : 768);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}

for (const [filter, format, hash] of [
  ["0.6:0.3", "gray", "e464079687f02957ec601e87c3a6c66668960ed0242e356dd915b154189c96a9"],
  ["high=0.6:0.3", "gray", "e464079687f02957ec601e87c3a6c66668960ed0242e356dd915b154189c96a9"],
  ["mode=colormix", "gray", "6101d9d0d31ab85867576e7b6026ff134478f346aead9270a4ec1b5d03a144ec"],
  ["mode=wires", "rgb24", "6ac67dec8e0dbf619f5e7f456725986215347cba26f67bbd6feccd45653cd7be"],
  ["mode=canny:planes=r+r", "rgb24", "87e7f0a527fb086afa3c005a56def4f410c16b13f414eecb248280d738dc4fb7"],
  ["mode=canny:planes=-r", "rgb24", "9b38388d19baa762c148135fd624fba42ec23ee6bce39bad56767740cfb99226"],
  ["mode=canny:planes=r+g", "rgb24", "b26bd26b98c8db200fdd9515c485ddd83299a576f9c0fc7d89fe776af374df90"],
  ["mode=canny:planes=none", "rgb24", "141ff10e8059c036f017b58aabed40d6859452e6f4ccaf248b4487703330a22a"],
  ["mode=canny:planes=all", "rgb24", "88736d5cf1d79f891d288912052d1fa9cf2f95a01794b324f5d37383c82fd38e"]
]) {
  it(`matches native option and format handling for ${filter} (${format})`, async () => {
    const { result, stderr, output } = await render(`edgedetect=${filter}`, format!);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

const yuv = Buffer.concat([gray,
  Buffer.from(Array.from({ length: 256 }, (_, i) => 40 + 110 * Number(Math.floor(i / 16) >= 8))),
  Buffer.from(Array.from({ length: 256 }, (_, i) => 25 + 120 * Number(i % 16 + Math.floor(i / 16) >= 15)))
]);
for (const [filter, hash] of [
  ["mode=canny", "08d6025d5a186886f0286744255aff4cd5e8a9f89f1705294754225813915ad6"],
  ["mode=canny:planes=u", "180969f906117fd6b4882f808d2ee58aa5fe6ed0a1556e7f9609aef17529728c"],
  ["mode=canny:enable=0", "ba1cff4bae42e30259e3d9fe368d2975f61d1fa4f10b904f13a539b72c3713e2"]
]) {
  it(`preserves native YUV samples for ${filter}`, async () => {
    const { result, stderr, output } = await render(`edgedetect=${filter}`, "yuv444p", yuv);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

it("applies the timeline per frame without carrying edge pixels between frames", async () => {
  const blank = Buffer.alloc(256, 35);
  const input = Buffer.concat([gray, blank, gray]);
  const filtered = await render("edgedetect");
  for (const graph of [false, true]) {
    const { result, stderr, output } = await render("edgedetect=enable='lt(n,2)'", "gray", input, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(output, Buffer.concat([filtered.output, Buffer.alloc(256), gray]));
  }
});

for (const option of ["high=2", "low=-1", "mode=3", "planes=missing", "unknown=1", "0.2:0.1:0:7:extra"]) {
  it(`rejects ${option} without writing video`, async () => {
    const { result, stderr, output } = await render(`edgedetect=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("edgedetect"), stderr);
    assert.equal(output.length, 0);
  });
}


it("preserves frame properties and honors memory, CPU, and cancellation limits", async () => {
  const data = new Uint8Array(64 * 64 * 4).fill(35);
  const frame = { data, width: 64, height: 64, ptsSeconds: 1.25, durationSeconds: 0.25, keyframe: true, offset: 1024 };
  const filtered = await edgedetect([frame], "", "gray", new MediaBudgetTracker());
  assert.equal(filtered.frames[0]!.ptsSeconds, frame.ptsSeconds);
  assert.equal(filtered.frames[0]!.durationSeconds, frame.durationSeconds);
  assert.equal(filtered.frames[0]!.offset, frame.offset);
  assert.deepEqual(data, new Uint8Array(data.length).fill(35));
  await assert.rejects(edgedetect([frame], "", "gray", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(edgedetect([frame], "", "gray", new MediaBudgetTracker({ maxCpuMs: -1 })), /maxCpuMs/);
  const controller = new AbortController();
  const budget = new MediaBudgetTracker();
  let checks = 0;
  budget.checkCpu = () => { if (++checks === 3) controller.abort(new Error("stop edgedetect")); };
  await assert.rejects(edgedetect([frame], "", "gray", budget, controller.signal), /stop edgedetect/);
});
