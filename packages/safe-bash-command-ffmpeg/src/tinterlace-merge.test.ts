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

for (const [filter, count, rate, hash] of [
  ["null", 6, 6, "9fee2551026c4a095069b733852e41fd575169a053540e53e6cdf1cde85fcdf0"],
  ...["tinterlace", "tinterlace=merge", "tinterlace=0", "tinterlace=mode=merge", "tinterlace=mode=0"].map(filter =>
    [filter, 3, 3, "238bf76388f2016070767320dfd5e7d5874dd28508f4a15fa589fa6ee38cd66f"] as const),
  ...["tinterlace=mergex2", "tinterlace=7", "tinterlace=mode=mergex2", "tinterlace=mode=7"].map(filter =>
    [filter, 5, 6, "4c49855d2f63bb1006d130b9792d55613fadfa44a0a37addbefacbb274ee173d"] as const)
] as const) {
  it(`matches native FFmpeg plane hash and metadata for ${filter}`, async () => {
    const result = await run(fixture().input, filter);
    assert.equal(result.exitCode, 0, result.stderr);
    const end = result.output.indexOf(10);
    const header = result.output.subarray(0, end).toString();
    const merge = filter !== "null";
    for (const token of ["W4", `H${merge ? 8 : 4}`, `F${rate}:1`, `I${merge ? "t" : "p"}`, `A${merge ? 2 : 1}:1`, "C444"]) {
      assert.ok(header.split(" ").includes(token), header);
    }
    const size = merge ? 96 : 48;
    const frames = [];
    for (let offset = end + 1; offset < result.output.length; offset += size + 6) {
      assert.equal(result.output.subarray(offset, offset + 6).toString(), "FRAME\n");
      frames.push(result.output.subarray(offset + 6, offset + 6 + size));
    }
    assert.equal(frames.length, count);
    assert.equal(createHash("sha256").update(Buffer.concat(frames)).digest("hex"), hash);
  });
}

for (const [chroma, format, depth] of [
  ["444", "yuv444p", 8], ["422", "yuv422p", 8], ["420jpeg", "yuv420p", 8],
  ["444", "yuv444p10le", 10], ["444", "yuv444p16le", 16]
] as const) {
  for (const mode of ["merge", "mergex2"]) {
    it(`merges all ${format} samples in ${mode} with an odd frame count`, async () => {
      const { input, frames } = fixture(true, 5, chroma, depth);
      const expected = [];
      for (let f = 0; f + 1 < frames.length; f += mode === "merge" ? 2 : 1) {
        let offset = 0;
        for (let p = 0; p < 3; p++) {
          const stride = (p && chroma !== "444" ? 2 : 4) * (depth === 8 ? 1 : 2);
          const height = p && chroma === "420jpeg" ? 2 : 4;
          for (let y = 0; y < height; y++) {
            for (const source of f % 2 ? [f + 1, f] : [f, f + 1]) {
              expected.push(frames[source]!.subarray(offset + y * stride, offset + (y + 1) * stride));
            }
          }
          offset += height * stride;
        }
      }
      const result = await run(input, `tinterlace=${mode}`, format, "rawvideo");
      assert.equal(result.exitCode, 0, result.stderr);
      const pixels = Buffer.concat(expected);
      assert.deepEqual(result.output, pixels);
      const frameSize = frames[0]!.length * 2;
      const woven = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H8 F${mode === "merge" ? 3 : 6}:1 It A2:1 C${chroma}${depth === 8 ? "" : `p${depth}`}\n`),
        ...Array.from({ length: pixels.length / frameSize }, (_, i) => [Buffer.from("FRAME\n"), pixels.subarray(i * frameSize, (i + 1) * frameSize)]).flat()]);
      const rendered = await run(input, `tinterlace=${mode},format=rgba`, "rgba", "rawvideo");
      // Match the filter renderer rather than the demuxer's integer RGB conversion.
      const reference = await run(woven, "scale=iw:ih,format=rgba", "rgba", "rawvideo");
      assert.equal(rendered.exitCode, 0, rendered.stderr);
      assert.equal(reference.exitCode, 0, reference.stderr);
      assert.deepEqual(rendered.output, reference.output);
    });
  }
}

for (const [mode, time, pair] of [["merge", "2/6", 2], ["mergex2", "1/6", 1]] as const) {
  it(`preserves ${mode} timestamps for downstream selection`, async () => {
    const result = await run(fixture().input, `tinterlace=${mode},select='eq(t,${time})'`, "yuv444p", "rawvideo");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 96);
    assert.equal(result.output[0], 32 + 24 * (pair + pair % 2));
  });
}

it("does not emit an unpaired frame", async () => {
  for (const mode of ["merge", "mergex2"]) {
    const result = await run(fixture(false, 1).input, `tinterlace=${mode}`, "yuv444p", "rawvideo");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 0);
  }
});

it("merges modified RGB rows after native planes are invalidated", async () => {
  const { input } = fixture(true, 5);
  const source = await run(input, "format=rgba,negate", "rgba", "rawvideo");
  assert.equal(source.exitCode, 0, source.stderr);
  for (const mode of ["merge", "mergex2"]) {
    const expected = [];
    for (let f = 0; f < 4; f += mode === "merge" ? 2 : 1) {
      for (let y = 0; y < 4; y++) {
        for (const frame of f % 2 ? [f + 1, f] : [f, f + 1]) {
          expected.push(source.output.subarray(frame * 64 + y * 16, frame * 64 + (y + 1) * 16));
        }
      }
    }
    const result = await run(input, `format=rgba,negate,tinterlace=${mode}`, "rgba", "rawvideo");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat(expected));
  }
});

it("checks doubled frame dimensions before replacing output", async () => {
  const result = await run(fixture().input, "tinterlace", "yuv444p", "rawvideo", { maxPixelsPerFrame: 16 });
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("maxPixelsPerFrame"), result.stderr);
  assert.equal(result.output.toString(), "KEEP");
});

it("doubles and reduces a non-square input sample aspect ratio", async () => {
  const input = Buffer.from(fixture().input);
  input.set(Buffer.from("A3:2"), input.indexOf("A1:1"));
  const result = await run(input, "tinterlace");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.output.subarray(0, result.output.indexOf(10)).toString().includes("A3:1"));
});
