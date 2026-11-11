import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { pullup } from "./pullup.js";
import { createFfmpegCommand } from "./index.js";

const ramp = Array.from({ length: 10 }, (_, i) => [16 + i * 16, 32 + i * 16] as const);
function pixels(pairs: readonly (readonly number[])[], color = false): Buffer {
  return Buffer.concat(pairs.map(([top, bottom], i) => Buffer.concat([
    ...Array.from({ length: 32 }, (_, y) => Buffer.alloc(32, y % 2 ? bottom : top)),
    ...Array.from({ length: 32 }, (_, y) => Buffer.alloc(16, color ? 64 + i * 8 + y % 2 : 128))
  ])));
}

async function run(input: Buffer, filter: string, options = {}, destination = "pipe:1") {
  const volume = Volume.fromJSON({ "/in.yuv": input, "/out.yuv": "KEEP" });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "yuv420p", "-video_size", "32x32",
      "-framerate", "10", "-i", "/in.yuv", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", "yuv420p", "-f", "rawvideo", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { chunks.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(chunks), volume };
}

// FFmpeg 7.0.2 reference: eight progressive pictures from ten alternating-field inputs.
it("pullup matches adjacent fields instead of passing through the input", async () => {
  const result = await run(pixels(ramp), "pullup");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, pixels(ramp.slice(1, -1).map(([top]) => [top, top])));
});

it("keeps the null control byte for byte", async () => {
  const input = pixels(ramp);
  const result = await run(input, "null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, input);
});

for (const [label, pairs, expected] of [
  ["progressive", ramp.map(([top]) => [top, top]), ramp.slice(0, -1).map(([top]) => [top, top])],
  ["static", Array.from({ length: 10 }, () => [64, 64]), Array.from({ length: 9 }, () => [64, 64])],
  ["opposite field phase", ramp.map(([top, bottom]) => [bottom, top]), ramp.slice(1, -1).map(([top, bottom]) => [bottom, top])],
  ["3:2 cadence", [[32, 32], [32, 64], [64, 96], [96, 96], [128, 128], [160, 160], [160, 192], [192, 224], [224, 224], [64, 64]],
    [32, 64, 96, 128, 160, 192, 224].map(v => [v, v])]
] as const) {
  it(`matches native pullup on ${label}`, async () => {
    const result = await run(pixels(pairs), "pullup");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, pixels(expected));
  });
}

it("uses the arrival timestamp of the frame completing the match", async () => {
  const result = await run(pixels(ramp), "pullup,select=eq(t\\,0.2)");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, pixels([[32, 32]]));
});

it("respects bottom-field-first input order", async () => {
  const result = await run(pixels(ramp), "setfield=bff,pullup");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, pixels(ramp.slice(1, -1)));
});

it("weaves original chroma samples with their corresponding fields", async () => {
  const input = pixels(ramp, true);
  const result = await run(input, "pullup");
  const expected = Buffer.concat(Array.from({ length: 8 }, (_, i) => {
    const frame = Buffer.alloc(1536);
    for (let plane = 0, offset = 0; plane < 3; plane++) {
      const width = plane ? 16 : 32, height = plane ? 16 : 32;
      for (let y = 0; y < height; y++) {
        const start = (i + (y % 2 ? 0 : 1)) * 1536 + offset + y * width;
        input.copy(frame, offset + y * width, start, start + width);
      }
      offset += width * height;
    }
    return frame;
  }));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, expected);
});

for (const length of [0, 1, 2, 3]) {
  it(`does not flush unmatched fields at EOF (${length} input frames)`, async () => {
    const result = await run(pixels(ramp.slice(0, length)), "pullup");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, length === 3 ? pixels([[32, 32]]) : Buffer.alloc(0));
  });
}

for (const option of ["unknown=1", "enable=1", "jl=-1", "mp=3", "jt=0"]) {
  it(`rejects unsupported pullup=${option} without writing output`, async () => {
    const result = await run(pixels(ramp), `pullup=${option}`, {}, "/out.yuv");
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("pullup"), result.stderr);
    assert.equal(result.output.length, 0);
    assert.equal(result.volume.readFileSync("/out.yuv").toString(), "KEEP");
  });
}

for (const option of ["1:1:4:4:0:0", "jl=0:jr=0:jt=1:jb=1", "sb=1", "sb=-1", "mp=y"]) {
  it(`matches fields with pullup=${option}`, async () => {
    const result = await run(pixels(ramp), `pullup=${option}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, pixels(ramp.slice(1, -1).map(([top]) => [top, top])));
  });
}

it("can use the chroma plane for matching", async () => {
  const result = await run(pixels(ramp), "pullup=mp=u");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, pixels(ramp.slice(0, -1)));
});

it("enforces resource limits and cancellation during field matching", async () => {
  const data = new Uint8Array(32 * 32 * 4);
  const frame = { width: 32, height: 32, data, ptsSeconds: 0, durationSeconds: 0.1, keyframe: true,
    native: { width: 32, height: 32, rgba: data, pixels: pixels([[32, 32]]), format: 0, colorspace: 5, fullRange: 0 } };
  await assert.rejects(pullup([frame], "", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(pullup([frame, frame], "", new MediaBudgetTracker({ maxFrames: 0 })), /maxFrames/);
  const controller = new AbortController();
  controller.abort(new Error("cancel pullup"));
  await assert.rejects(pullup([frame], "", new MediaBudgetTracker(), controller.signal), /cancel pullup/);
});
