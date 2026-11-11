import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

function fixture(color = false, count = 6, chroma = "444", depth = 8) {
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
  return { frames, input: Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C${chroma}${depth === 8 ? "" : `p${depth}`}\n`),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]) };
}

async function run(input: Uint8Array, filter: string, format = "yuv444p", muxer = "yuv4mpegpipe", limits = {}) {
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

// Payload hashes captured from native FFmpeg 7.0.2, excluding Y4M framing.
for (const [filter, bottom, hash] of [
  ["doubleweave", false, "4c49855d2f63bb1006d130b9792d55613fadfa44a0a37addbefacbb274ee173d"],
  ["doubleweave=first_field=bottom", true, "14a61966586004d2558b908593fd15d68b2858426d10fdc0098ba05f9cb20665"]
] as const) {
  it(`matches native overlapping pairs and metadata for ${filter}`, async () => {
    const input = fixture().input;
    if (bottom) input.set(Buffer.from("Ib"), input.indexOf("Ip"));
    const result = await run(input, filter);
    assert.equal(result.exitCode, 0, result.stderr);
    const end = result.output.indexOf(10);
    assert.deepEqual(result.output.subarray(0, end).toString().split(" ").slice(0, 7),
      ["YUV4MPEG2", "W4", "H8", "F6:1", bottom ? "Ib" : "It", "A1:1", "C444"]);
    const frames: Buffer[] = [];
    for (let offset = end + 1; offset < result.output.length; offset += 102) {
      assert.equal(result.output.subarray(offset, offset + 6).toString(), "FRAME\n");
      frames.push(result.output.subarray(offset + 6, offset + 102));
    }
    assert.equal(frames.length, 5);
    assert.equal(createHash("sha256").update(Buffer.concat(frames)).digest("hex"), hash);
    assert.deepEqual(frames.slice(0, 2).map(frame => Array.from({ length: 8 }, (_, y) => frame[y * 4])),
      bottom ? [[56, 32, 59, 35, 62, 38, 65, 41], [56, 80, 59, 83, 62, 86, 65, 89]]
        : [[32, 56, 35, 59, 38, 62, 41, 65], [80, 56, 83, 59, 86, 62, 89, 65]]);
    const raw = await run(input, filter, "yuv444p", "rawvideo");
    assert.equal(raw.exitCode, 0, raw.stderr);
    assert.deepEqual(raw.output, Buffer.concat(frames));
  });
}

for (const [chroma, format, depth] of [
  ["444", "yuv444p", 8], ["422", "yuv422p", 8], ["420jpeg", "yuv420p", 8],
  ["444", "yuv444p10le", 10], ["444", "yuv444p16le", 16]
] as const) {
  for (const bottom of [false, true]) {
    it(`preserves all ${format} plane samples with ${bottom ? "bottom" : "top"} first`, async () => {
      const { input, frames } = fixture(true, 5, chroma, depth);
      const expected: Buffer[] = [];
      for (let f = 0; f + 1 < frames.length; f++) {
        let offset = 0;
        for (let p = 0; p < 3; p++) {
          const stride = (p && chroma !== "444" ? 2 : 4) * (depth === 8 ? 1 : 2);
          const height = p && chroma === "420jpeg" ? 2 : 4;
          for (let y = 0; y < height; y++) {
            for (const source of Boolean(f % 2) !== bottom ? [f + 1, f] : [f, f + 1]) {
              expected.push(frames[source]!.subarray(offset + y * stride, offset + (y + 1) * stride));
            }
          }
          offset += height * stride;
        }
      }
      const result = await run(input, `doubleweave=${bottom ? "bottom" : "top"}`, format, "rawvideo");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, Buffer.concat(expected));
    });
  }
}

for (const option of ["top", "t", "0", "first_field=top", "first_field=0", "bottom", "b", "1", "first_field=b", "first_field=1"]) {
  it(`accepts first-field option ${option}`, async () => {
    const bottom = ["bottom", "b", "1", "first_field=b", "first_field=1"].includes(option);
    const result = await run(fixture().input, `doubleweave=${option}`, "yuv444p", "rawvideo");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), bottom
      ? "14a61966586004d2558b908593fd15d68b2858426d10fdc0098ba05f9cb20665"
      : "4c49855d2f63bb1006d130b9792d55613fadfa44a0a37addbefacbb274ee173d");
  });
}

it("preserves timestamps and non-square sample aspect ratio", async () => {
  const input = fixture().input;
  input.set(Buffer.from("A3:2"), input.indexOf("A1:1"));
  const result = await run(input, "doubleweave,select='eq(t,1/6)'");
  assert.equal(result.exitCode, 0, result.stderr);
  const end = result.output.indexOf(10);
  assert.ok(result.output.subarray(0, end).toString().includes("A3:2"));
  assert.equal(result.output.length - end - 1, 102);
  assert.equal(result.output[end + 7], 80);
});

it("drops an unpaired field at EOF", async () => {
  const result = await run(fixture(false, 1).input, "doubleweave", "yuv444p", "rawvideo");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.length, 0);
});

it("weaves modified RGB rows after native planes are invalidated", async () => {
  const input = fixture(true, 3).input;
  const source = await run(input, "format=rgba,negate", "rgba", "rawvideo");
  assert.equal(source.exitCode, 0, source.stderr);
  for (const bottom of [false, true]) {
    const expected: Buffer[] = [];
    for (let f = 0; f < 2; f++) {
      for (let y = 0; y < 4; y++) {
        for (const frame of Boolean(f % 2) !== bottom ? [f + 1, f] : [f, f + 1]) {
          expected.push(source.output.subarray(frame * 64 + y * 16, frame * 64 + (y + 1) * 16));
        }
      }
    }
    const result = await run(input, `format=rgba,negate,doubleweave=${bottom ? "bottom" : "top"}`, "rgba", "rawvideo");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat(expected));
  }
});

for (const filter of ["doubleweave=first_field=sideways", "doubleweave=2", "doubleweave=-1", "doubleweave=mode=merge", "doubleweave=top:bottom"]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const result = await run(fixture().input, filter);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("doubleweave"), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("enforces doubled frame limits before replacing output", async () => {
  const result = await run(fixture().input, "doubleweave", "yuv444p", "rawvideo", { maxPixelsPerFrame: 16 });
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
    const expected = await run(input, "doubleweave=" + field);
    assert.equal(expected.exitCode, 0, expected.stderr);
    for (const option of [value, `first_field=${value}`]) {
      const result = await run(input, `doubleweave=${option}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, expected.output);
    }
  });
}

for (const value of ["-0.1", "1.1", "1/0", "0/0", "unknown", "2:first_field=top"]) {
  it(`rejects invalid first_field=${value} before replacing output`, async () => {
    const result = await run(fixture().input, `doubleweave=first_field=${value}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  });
}
