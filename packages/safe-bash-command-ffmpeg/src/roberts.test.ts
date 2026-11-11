import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const gray = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  35 + 30 * Number(i % 16 >= 4) + 100 * Number(i % 16 >= 9) + 35 * Number(Math.floor(i / 16) >= 8)));
const yuv = Buffer.from(Array.from({ length: 768 }, (_, i) => {
  const p = Math.floor(i / 256), x = i % 16, y = Math.floor(i % 256 / 16);
  return 30 + 12 * p + 35 * Number(x >= 3 + p) + 75 * Number(y >= 8 - p);
}));

async function run(filter: string, input = gray, format = "gray") {
  const volume = Volume.fromJSON({ "/in.raw": input });
  let stderr = "";
  const chunks: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "16x16", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(chunks) };
}

for (const [filter, input, format, hash] of [
  ["null", gray, "gray", "e0f4379e4b087c0e78cd7d80564fd8f5179b43190156edb3e3c9d2f2c2d343c1"],
  ["null", yuv, "yuv444p", "e4e66b964c894fd8aca67955e0584a51e6c66c25020c315a9ce616409c6d7748"],
  ["roberts", gray, "gray", "1486bb86e5148cc93ed8ccc1edf245ae18fdfe8bee8167d462e59959d9fb77e0"],
  ["roberts=scale=0.25:delta=16", gray, "gray", "a4d8d345066edc90312f62f9f9e8460191f13b7ffa622bbcce3811e99a6aca8b"],
  ["roberts=planes=2:scale=0.25:delta=16", yuv, "yuv444p", "937704bc8ed4de4055cb8b214bfe375635410d5886825e15f09e136068668fc8"]
] as const) {
  it(`matches native FFmpeg 7.0.2 ${format} ${filter}`, async () => {
    const result = await run(filter, input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    if (filter.startsWith("roberts=planes=2")) {
      assert.deepEqual(result.output.subarray(0, 256), input.subarray(0, 256));
      assert.deepEqual(result.output.subarray(512), input.subarray(512));
    }
  });
}

it("preserves disabled frames and unselected planes", async () => {
  for (const filter of ["roberts=planes=0", "roberts=enable=0"]) {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, gray);
  }
});

for (const option of ["planes=16", "scale=-1", "delta=65536", "unknown=1"]) {
  it(`rejects invalid ${option} without emitting a frame`, async () => {
    const result = await run(`roberts=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /roberts/);
    assert.equal(result.output.length, 0);
  });
}

// Native references exercise reflected borders, clipping, and positional options.
for (const [filter, hash] of [
  ["roberts", "89d04cc7d87b5b360ffcf48cff16d304a4842dc1355dc64a87a4e9b422995c83"],
  ["roberts=15:0.25:16", "039bb1f2f7053f10f0edce45ba0d92467ed8039fae525aa54d6f64b116c78cba"],
  ["roberts=scale=10:delta=-30", "3d6876a0146de8576eb2395a858de1213d1b92c65b779df3a331cfd5a4584546"]
] as const) {
  it(`matches native ${filter} on varied samples and borders`, async () => {
    const input = Buffer.from(Array.from({ length: 256 }, (_, i) => (i % 16 * 37 + Math.floor(i / 16) * 61) % 256));
    const result = await run(filter, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}
