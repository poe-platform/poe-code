import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, format: string, filter: string, size = "2x2", outputFormat = format) {
  const highDepth = format === "yuv444p10le" || format === "yuv444p16le";
  const source = highDepth ? Buffer.concat([
    Buffer.from(`YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C${format === "yuv444p10le" ? "444p10" : "444p16"}\n`),
    ...Array.from({ length: input.length / 24 }, (_, i) =>
      Buffer.concat([Buffer.from("FRAME\n"), input.subarray(i * 24, (i + 1) * 24)]))
  ]) : input;
  const volume = Volume.fromJSON({ "/in.raw": source });
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...(highDepth ? ["-f", "yuv4mpegpipe"] :
      ["-f", "rawvideo", "-pixel_format", format, "-video_size", size]),
      "-i", "/in.raw", "-vf", filter, "-pix_fmt", outputFormat, "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(volume.readFileSync("/in.raw"), source);
  return Buffer.concat(output);
}

// Native FFmpeg 7: preserve Y and exchange the complete U and V planes.
for (const [format, size, inputHex, expectedHex] of [
  ["yuv420p", "2x2", "101a242e3842", "101a242e4238"],
  ["yuva420p", "4x2", "111c27323d48535e69747f8a95a0abb6c1ccd7e2", "111c27323d48535e7f8a697495a0abb6c1ccd7e2"],
  ["yuva420p", "3x3", "000102030405060708090a0b0c0d0e0f10007f80feff11223344", "0001020304050607080d0e0f10090a0b0c007f80feff11223344"],
  ["yuva420p", "1x1", "1080ff80", "10ff8080"],
  ["yuva444p", "2x2", "101a242e38424c56606a747e007f80ff", "101a242e606a747e38424c56007f80ff"],
  ["yuv422p", "2x2", "101a242e38424c56", "101a242e4c563842"],
  ["yuv444p", "2x2", "101a242e38424c56606a747e", "101a242e606a747e38424c56"],
  ["yuv420p", "3x3", "101a242e38424c5660606a747e88929ca6", "101a242e38424c566088929ca6606a747e"],
  ["yuv444p10le", "2x2", "400068009000b800e0000801300158018001a801d001f801", "400068009000b8008001a801d001f801e000080130015801"],
  ["yuv444p16le", "2x2", "0110021a0324042e05380642074c085609600a6a0b740c7e", "0110021a0324042e09600a6a0b740c7e05380642074c0856"]
] as const) {
  it(`swaps ${format} ${size} chroma without changing luma or precision`, async () => {
    const input = Buffer.from(inputHex, "hex");
    const expected = Buffer.from(expectedHex, "hex");
    assert.deepEqual(await run(input, format, "null", size), input);
    assert.deepEqual(await run(input, format, "swapuv", size), expected);
    assert.deepEqual(await run(input, format, "swapuv,swapuv", size), input);
    assert.deepEqual(await run(Buffer.concat([input, expected]), format, "swapuv", size), Buffer.concat([expected, input]));
  });
}

for (const [filter, expectedHex] of [
  ["swapuv=enable='eq(n,1)'", "2f3a45505b66717c87929da8b3bec9d4df18232e4f5a3944"],
  ["swapuv=enable='gte(t,0.04)'", "2f3a45505b66717c87929da8b3bec9d4df18232e4f5a3944"],
  ["swapuv=enable=0", "2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a"],
  ["swapuv=enable=NAN", "2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a"],
  ["swapuv", "2f3a45505b66717c9da88792b3bec9d4df18232e4f5a3944"],
  ["swapuv,swapuv", "2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a"]
] as const) {
  it(`honors the per-frame timeline for ${filter}`, async () => {
    const input = Buffer.from("2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a", "hex");
    assert.deepEqual(await run(input, "yuv420p", filter, "4x2"), Buffer.from(expectedHex, "hex"));
  });
}

it("renders the swapped chroma for downstream RGB consumers", async () => {
  const input = Buffer.from("5064788c3090c020d06040b0", "hex");
  const swapped = Buffer.from("5064788cd06040b03090c020", "hex");
  const actual = await run(input, "yuv444p", "swapuv,format=rgba", "2x2", "rgba");
  const expected = await run(swapped, "yuv444p", "format=rgba", "2x2", "rgba");
  assert.equal(actual.length, expected.length);
  // The raw decoder and swscale use slightly different RGB rounding.
  for (const [i, value] of actual.entries()) assert.ok(Math.abs(value - expected[i]!) <= 2);
});

// Native FFmpeg 7.0.2 RGBA output includes packed-to-planar alpha rounding.
for (const [filter, expected] of [
  ["swapuv", "41352c506e62587c9a8e84a9c5b9afd52d47ff2e4c40365a776b6187a3978eb3"],
  ["swapuv,swapuv", "2e3a44505b67707c87939ca9b2bec8d5e018232e39454e5a64707a87909ca6b3"],
  ["format=yuva444p,swapuv", "41352c506e62587c9a8e84a9c5b9afd52d47ff2e4c40365a776b6187a3978eb3"],
  ["null", "2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a65707b86919ca7b2"],
  ["format=yuv444p,format=rgba", "2e3a44ff5b6770ff87939cffb2bec8ffe01823ff39454eff64707aff909ca6ff"]
] as const) {
  it(`matches native RGBA samples for ${filter}`, async () => {
    const input = Buffer.from("2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a65707b86919ca7b2", "hex");
    assert.equal((await run(input, "rgba", filter, "4x2")).toString("hex"), expected);
  });
}
