import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: string, format: string, filter: string, outputFormat = format) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2",
      "-i", "/in.raw", "-vf", filter, "-pix_fmt", outputFormat, "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { output.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(output) };
}

// Native FFmpeg 7.0.2: hue=s=0 preserves Y and sets every U/V sample to 128.
for (const [format, input, expected] of [
  ["yuv420p", "101a242e3842", "101a242e8080"],
  ["yuv422p", "101a242e38424c56", "101a242e80808080"],
  ["yuv444p", "101a242e38424c56606a747e", "101a242e8080808080808080"]
] as const) {
  it(`matches native desaturation bytes for ${format}`, async () => {
    const result = await run(input, format, "hue=s=0");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });

  it(`preserves the ${format} null-filter control`, async () => {
    const result = await run(input, format, "null");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), input);
  });
}

it("preserves out-of-range luma and desaturates every frame", async () => {
  const result = await run("000febff00ff101a242e3842", "yuv420p", "hue=s=0");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "000febff8080101a242e8080");
});

it("retains the desaturated planes for downstream YUV filters", async () => {
  const result = await run("101a242e3842", "yuv420p", "hue=s=0,negate=components=y");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "efe5dbd18080");
});

it("refreshes RGB pixels after changing retained chroma", async () => {
  const result = await run("101a242e3842", "yuv420p", "hue=s=0,format=rgba", "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.length, 16);
  for (let i = 0; i < result.output.length; i += 4) {
    assert.equal(result.output[i], result.output[i + 1]);
    assert.equal(result.output[i], result.output[i + 2]);
    assert.equal(result.output[i + 3], 255);
  }
});

for (const filter of ["hue", "hue=s=1", "hue=s=0:h=90", "hue=s=0:unknown=1", "hue=0"]) {
  it(`rejects unsupported hue options without emitting output: ${filter}`, async () => {
    const result = await run("101a242e3842", "yuv420p", filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.length, 0);
  });
}
