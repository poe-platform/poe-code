import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

function fixture(color = false, count = 6, chroma = "444", depth = 8, order = "p") {
  const frames = Array.from({ length: count }, (_, i) => Buffer.concat(
    Array.from({ length: 3 }, (_, p) => {
      const width = p && chroma !== "444" ? 2 : 4;
      const height = p && chroma === "420jpeg" ? 2 : 4;
      const plane = Buffer.alloc(width * height * (depth === 8 ? 1 : 2));
      for (let y = 0; y < height; y++) {
        const value = (p === 0 ? 32 + 24 * i + 3 * y : !color ? 128 : p === 1 ? 35 + 9 * i + y : 216 - 8 * i - y) * 2 ** (depth - 8);
        for (let x = 0; x < width; x++) {
          if (depth === 8) plane[y * width + x] = value;
          else plane.writeUInt16LE(value + 3, (y * width + x) * 2);
        }
      }
      return plane;
    })));
  return { frames, input: Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 I${order} A1:1 C${chroma}${depth === 8 ? "" : `p${depth}`}\n`),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]) };
}

async function run(input: Uint8Array, filter: string, format = "yuv444p", muxer = "rawvideo", limits = {}) {
  const volume = Volume.fromJSON({ "/in.y4m": Buffer.from(input), "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-f", muxer, "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}

it("matches native FFmpeg's default weave payload, height, rate and field order", async () => {
  const result = await run(fixture().input, "weave", "yuv444p", "yuv4mpegpipe");
  assert.equal(result.exitCode, 0, result.stderr);
  const end = result.output.indexOf(10);
  assert.deepEqual(result.output.subarray(0, end).toString().split(" ").slice(0, 7),
    ["YUV4MPEG2", "W4", "H8", "F3:1", "It", "A1:1", "C444"]);
  const frames = [];
  for (let offset = end + 1; offset < result.output.length; offset += 102) {
    assert.equal(result.output.subarray(offset, offset + 6).toString(), "FRAME\n");
    frames.push(result.output.subarray(offset + 6, offset + 102));
  }
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.slice(0, 2).map(frame => Array.from({ length: 8 }, (_, y) => frame[y * 4])),
    [[32, 56, 35, 59, 38, 62, 41, 65], [80, 104, 83, 107, 86, 110, 89, 113]]);
  assert.equal(createHash("sha256").update(Buffer.concat(frames)).digest("hex"),
    "238bf76388f2016070767320dfd5e7d5874dd28508f4a15fa589fa6ee38cd66f");
});

it("matches native bottom-first weave with bottom-first input", async () => {
  const result = await run(fixture(false, 6, "444", 8, "b").input, "weave=first_field=bottom");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.length, 288);
  assert.equal(createHash("sha256").update(result.output).digest("hex"),
    "371cab13eb158d06e23275c9a159c68c270dd0aecd60a2b8b867a3d73f08e919");
});

it("preserves the null control", async () => {
  const result = await run(fixture().input, "null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(createHash("sha256").update(result.output).digest("hex"),
    "9fee2551026c4a095069b733852e41fd575169a053540e53e6cdf1cde85fcdf0");
});

for (const [chroma, format, depth] of [
  ["444", "yuv444p", 8], ["422", "yuv422p", 8], ["420jpeg", "yuv420p", 8],
  ["444", "yuv444p10le", 10], ["444", "yuv444p16le", 16]
] as const) {
  for (const field of ["top", "bottom"]) {
    it(`weaves disjoint ${format} pairs ${field}-first and drops the unmatched frame`, async () => {
      const { input, frames } = fixture(true, 5, chroma, depth);
      const expected = [];
      for (let f = 0; f + 1 < frames.length; f += 2) {
        let offset = 0;
        for (let p = 0; p < 3; p++) {
          const stride = (p && chroma !== "444" ? 2 : 4) * (depth === 8 ? 1 : 2);
          const height = p && chroma === "420jpeg" ? 2 : 4;
          for (let y = 0; y < height; y++) {
            for (const source of field === "top" ? [f, f + 1] : [f + 1, f]) {
              expected.push(frames[source]!.subarray(offset + y * stride, offset + (y + 1) * stride));
            }
          }
          offset += height * stride;
        }
      }
      const result = await run(input, `weave=first_field=${field}`, format);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, Buffer.concat(expected));
    });
  }
}

for (const [field, aliases, order] of [["top", ["top", "t", "0"], "TOPFIRST"], ["bottom", ["bottom", "b", "1"], "BOTTOMFIRST"]] as const) {
  it(`accepts ${field}-first aliases and preserves pair timestamps and downstream field metadata`, async () => {
    for (const alias of aliases) {
      const result = await run(fixture().input, `weave=${alias},select='eq(t,1/3)*eq(interlace_type,${order})'`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, 96);
      assert.equal(result.output[0], field === "top" ? 80 : 104);
    }
  });
}

it("weaves modified RGBA rows without stale native planes", async () => {
  const input = fixture(true, 5).input;
  const source = await run(input, "format=rgba,negate", "rgba");
  assert.equal(source.exitCode, 0, source.stderr);
  const expected = [];
  for (let f = 0; f < 4; f += 2) {
    for (let y = 0; y < 4; y++) {
      for (const frame of [f + 1, f]) {
        expected.push(source.output.subarray(frame * 64 + y * 16, frame * 64 + (y + 1) * 16));
      }
    }
  }
  const result = await run(input, "format=rgba,negate,weave=b", "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat(expected));
});

it("emits no frame from a single input", async () => {
  const result = await run(fixture(false, 1).input, "weave");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.length, 0);
});

it("preserves non-square sample aspect ratio and marks bottom-first output", async () => {
  const input = fixture().input;
  input.set(Buffer.from("A3:2"), input.indexOf("A1:1"));
  const result = await run(input, "weave=b", "yuv444p", "yuv4mpegpipe");
  assert.equal(result.exitCode, 0, result.stderr);
  const header = result.output.subarray(0, result.output.indexOf(10)).toString().split(" ");
  assert.ok(header.includes("A3:2"));
  assert.ok(header.includes("Ib"));
});

it("rejects invalid options and excessive doubled dimensions before replacing output", async () => {
  for (const filter of ["weave=first_field=invalid", "weave=first_field=2", "weave=unknown=top", "weave=top:bottom", "weave=enable=1"]) {
    const result = await run(fixture().input, filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  }
  const result = await run(fixture().input, "weave", "yuv444p", "rawvideo", { maxPixelsPerFrame: 16 });
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("maxPixelsPerFrame"), result.stderr);
  assert.equal(result.output.toString(), "KEEP");
});

for (const [value, field] of [
  ["0.75", "bottom"], ["1/2", "top"], ["max", "bottom"],
  ["default", "top"], ["min", "top"], ["bottom-top", "bottom"],
  ["1/4", "top"], ["1-1/4", "bottom"], ["PI/4", "bottom"]
] as const) {
  it(`evaluates first_field=${value} with native integer rounding`, async () => {
    const input = fixture().input;
    const expected = await run(input, "weave=" + field);
    assert.equal(expected.exitCode, 0, expected.stderr);
    for (const option of [value, `first_field=${value}`]) {
      const result = await run(input, `weave=${option}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, expected.output);
    }
  });
}

for (const value of ["-0.1", "1.1", "1/0", "0/0", "unknown", "2:first_field=top"]) {
  it(`rejects invalid first_field=${value} before replacing output`, async () => {
    const result = await run(fixture().input, `weave=first_field=${value}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  });
}
