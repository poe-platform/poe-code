import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

function fixture(color = false, chroma = "444", aspect = "1:1", range = "LIMITED") {
  const depth = chroma === "444p10" ? 10 : chroma === "444p16" ? 16 : 8;
  const planes = Array.from({ length: 6 }, (_, frame) => Array.from({ length: 3 }, (_, plane) =>
    Array.from({ length: plane > 0 && chroma === "420jpeg" ? 2 : 4 }, (_, row) => {
      const value = plane === 0 ? 32 + 24 * frame + 3 * row : !color ? 128
        : plane === 1 ? 35 + 9 * frame + row : 216 - 8 * frame - row;
      const width = plane > 0 && !chroma.startsWith("444") ? 2 : 4;
      const bytes = Buffer.alloc(width * (depth > 8 ? 2 : 1));
      for (let x = 0; x < width; x++) {
        if (depth === 8) bytes[x] = value;
        else bytes.writeUInt16LE(value * 2 ** (depth - 8) + frame + row, x * 2);
      }
      return bytes;
    })));
  const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 Ip A${aspect} C${chroma} XCOLORRANGE=${range}\n`),
    ...planes.flatMap(frame => [Buffer.from("FRAME\n"), ...frame.flat()])]);
  return { input, planes, depth };
}

async function run(input: Buffer, filter: string, format = "yuv444p", muxer = "yuv4mpegpipe", limits = {}) {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/out": "KEEP" });
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
  assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}

function payload(output: Buffer, frameBytes: number, count: number) {
  const headerEnd = output.indexOf(10) + 1;
  assert.equal(output.length - headerEnd, count * (6 + frameBytes));
  return Buffer.concat(Array.from({ length: count }, (_, frame) => {
    const start = headerEnd + frame * (6 + frameBytes);
    assert.equal(output.subarray(start, start + 6).toString(), "FRAME\n");
    return output.subarray(start + 6, start + 6 + frameBytes);
  }));
}

// Native Linux FFmpeg 7.0.2 plane hashes from the reported six-frame fixture.
for (const [filter, height, count, aspect, hash] of [
  ["null", 4, 6, "1:1", "9fee2551026c4a095069b733852e41fd575169a053540e53e6cdf1cde85fcdf0"],
  ...["tinterlace=pad", "tinterlace=mode=pad", "tinterlace=3"].map(filter =>
    [filter, 8, 5, "2:1", "47555de132a5d96e662503dcac84328d29dbea6de29ac748aa9a534baa75c8d5"] as const)
] as const) {
  it(`matches native dimensions, rate, aspect and grayscale bytes for ${filter}`, async () => {
    const result = await run(fixture().input, filter);
    assert.equal(result.exitCode, 0, result.stderr);
    const header = result.output.subarray(0, result.output.indexOf(10)).toString().split(" ");
    for (const token of ["W4", `H${height}`, "F6:1", "Ip", `A${aspect}`, "C444"]) assert.ok(header.includes(token), header.join(" "));
    assert.equal(createHash("sha256").update(payload(result.output, 4 * height * 3, count)).digest("hex"), hash);
  });
}

// Captured from FFmpeg 7.0.2 for the color fixture, limited range then full range.
for (const [chroma, format, limitedHash, fullHash] of [
  ["444", "yuv444p", "2769eff02645363280842bc0c60271af5b82b997114144ee09542ea11002961c", "2406ad5aa77f84f18a177e53253ec0aa1cb217ae79847680ae2588543620e317"],
  ["422", "yuv422p", "45513295ebdd857e1277a3255d3546426b26980eafaa554ba46ad51a9befbe6e", "2cd46b6dbd26e1d659302d0a2d0ba6048d2446443a9cfdadda79cde14b8192a8"],
  ["420jpeg", "yuv420p", "e8655efe984d09a0d295577d696f0070652d7578feb653b1b02655f04e9f5b12", "9df46ef088c4f64e6c02d8383b4009988f9f4fe9dd54375361b2764534d49ea8"],
  ["444p10", "yuv444p10le", "3eac94ebe7fcdce71b1beeeb69d1d59d636777731af9e14000be2103fc432bf7", "b9b64c660e0664bc9f680c898be76793c1c05540501c823d5fd7e1b925a69611"],
  // Native negotiates a lower depth for 16-bit input; retain our existing lossless plane convention.
  ["444p16", "yuv444p16le", undefined, undefined]
]) {
  for (const range of ["LIMITED", "FULL"]) {
    it(`pads alternating ${format} planes with ${range.toLowerCase()}-range black`, async () => {
      const { input, planes, depth } = fixture(true, chroma, "3:2", range);
      const expected = Buffer.concat(planes.slice(0, -1).flatMap((frame, index) => frame.flatMap((rows, plane) =>
        rows.flatMap(row => {
          const black = Buffer.alloc(row.length);
          const value = range === "FULL" ? (plane === 0 ? 0 : 2 ** (depth - 1))
            : Math.round((plane === 0 ? 16 : 128) * (2 ** depth - 1) / 255);
          if (depth === 8) black.fill(value);
          else for (let offset = 0; offset < black.length; offset += 2) black.writeUInt16LE(value, offset);
          return index % 2 === 0 ? [row, black] : [black, row];
        }))));
      const result = await run(input, "tinterlace=pad", format, "rawvideo");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, expected);
      const hash = range === "FULL" ? fullHash : limitedHash;
      if (hash) assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    });
  }
}

it("preserves timestamps and reduces doubled sample aspect ratio", async () => {
  const result = await run(fixture(false, "444", "3:2").input, "tinterlace=pad,select='eq(t,0.5)'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.output.subarray(0, result.output.indexOf(10)).toString().includes(" A3:1 "));
  const bytes = payload(result.output, 96, 1);
  assert.deepEqual(Array.from({ length: 8 }, (_, row) => bytes[row * 4]), [16, 104, 16, 107, 16, 110, 16, 113]);
});

for (const count of [1, 2, 5]) {
  it(`drops only the final buffered frame of a ${count}-frame clip`, async () => {
    const result = await run(fixture().input, `trim=end_frame=${count},tinterlace=pad`, "yuv444p", "rawvideo");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, (count - 1) * 96);
  });
}

it("pads current RGB pixels after an upstream filter invalidates native planes", async () => {
  const input = fixture(true).input;
  const source = await run(input, "format=rgba,negate", "rgba", "rawvideo");
  assert.equal(source.exitCode, 0, source.stderr);
  const black = Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const expected = Buffer.concat(Array.from({ length: 5 }, (_, frame) =>
    Array.from({ length: 4 }, (_, row) => {
      const start = frame * 64 + row * 16;
      const pixels = source.output.subarray(start, start + 16);
      return frame % 2 === 0 ? [pixels, black] : [black, pixels];
    }).flat()).flat());
  const result = await run(input, "format=rgba,negate,tinterlace=pad", "rgba", "rawvideo");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, expected);
});

it("renders padded subsampled chroma for downstream RGB consumers", async () => {
  const input = fixture(true, "420jpeg").input;
  const padded = await run(input, "tinterlace=pad", "yuv420p");
  assert.equal(padded.exitCode, 0, padded.stderr);
  const expected = await run(padded.output, "scale=iw:ih,format=rgba", "rgba", "rawvideo");
  const result = await run(input, "tinterlace=pad,format=rgba", "rgba", "rawvideo");
  assert.equal(expected.exitCode, 0, expected.stderr);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, expected.output);
});

for (const filter of ["tinterlace=pad:unknown=1", "tinterlace=pad:enable=0"]) {
  it(`rejects ${filter} before replacing output`, async () => {
    const result = await run(fixture().input, filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("enforces the doubled frame's pixel budget before replacing output", async () => {
  const result = await run(fixture().input, "tinterlace=pad", "yuv444p", "yuv4mpegpipe", { maxPixelsPerFrame: 16 });
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("maxPixelsPerFrame"), result.stderr);
  assert.equal(result.output.toString(), "KEEP");
});
