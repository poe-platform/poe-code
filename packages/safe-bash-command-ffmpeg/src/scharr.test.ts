import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const gray = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  35 + 30 * Number(i % 16 >= 4) + 100 * Number(i % 16 >= 9) + 35 * Number(Math.floor(i / 16) >= 8)));
const yuv = Buffer.from(Array.from({ length: 768 }, (_, i) => {
  const plane = Math.floor(i / 256);
  return 30 + 12 * plane + 35 * Number(i % 16 >= 3 + plane) + 75 * Number(Math.floor(i % 256 / 16) >= 8 - plane);
}));

async function run(filter: string, input = gray, format = "gray") {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Uint8Array[] = [];
  let stderr = "";
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
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { result, stderr, output: Buffer.concat(chunks) };
}

for (const [filter, hash, row] of [
  ["scharr", "86c32ff08ee48ee773ab6f216b63a5e4c7d53faaf70debf9047f0aa3f8258b9c",
    [35, 35, 35, 46, 46, 35, 35, 35, 105, 105, 35, 35, 35, 35, 35, 35]],
  ["scharr=scale=0.25:delta=16", "ff68b9472aee720e5d8c2b3f89d3cdf843ef3a2b79907188ccab86b8093d0a94",
    [24, 24, 24, 27, 27, 24, 24, 24, 42, 42, 24, 24, 24, 24, 24, 24]]
] as const) {
  it(`matches native grayscale ${filter}`, async () => {
    const { result, stderr, output } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, 256);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    assert.deepEqual([...output.subarray(7 * 16, 8 * 16)], row);
  });
}

it("filters only U while retaining exact Y and V samples", async () => {
  const { result, stderr, output } = await run("scharr=planes=2:scale=0.25:delta=16", yuv, "yuv444p");
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(output.length, 768);
  assert.equal(createHash("sha256").update(output).digest("hex"), "d91b31c64b5920ceca7dc6c0b2a3e939efed38397f5ff06169ecac93104f0660");
  assert.deepEqual(output.subarray(0, 256), yuv.subarray(0, 256));
  assert.deepEqual(output.subarray(512), yuv.subarray(512));
  assert.equal(output.subarray(256, 512).filter((value, i) => value !== yuv[256 + i]).length, 256);
});

for (const format of ["gray", "yuv444p"]) {
  for (const filter of ["null", "scharr=planes=0", "scharr=enable=0"]) {
    it(`preserves ${format} bytes for ${filter}`, async () => {
      const input = format === "gray" ? gray : yuv;
      const { result, stderr, output } = await run(filter, input, format);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(output, input);
    });
  }
}

for (const [format, length, filter, hash] of [
  ["gray", 256, "scharr", "41345a3a05e9229946fb65cdc8e4cfe765da5cb86d94cc9e226af124f79b059e"],
  ["gray", 256, "scharr=15:2:-16", "244bcf9d6206a5a5d241f40ca02733868b95a1d3f2b7b4c0083636bb6ef170cb"],
  ["yuv420p", 384, "scharr", "8df9a45f4da415efae788760806408046d8b55564b812a09d5c8acb0f5e043ac"],
  ["yuv422p", 512, "scharr=planes=2:scale=0.25:delta=16", "ae571b57e2099ee8fd282690f1a23d4d7678bfbb0a3e8dec6fa903e25dac989c"],
  ["yuv444p", 768, "scharr", "34d3e9e55707e758ac7d5183f356df2f6958ab1951bcf6e763f6acfcb6addebf"]
] as const) {
  it(`matches native border, rounding and clipping for ${format} ${filter}`, async () => {
    const input = Buffer.from(Array.from({ length }, (_, i) => (i * 17 + Math.floor(i / 16) * 31) % 256));
    const { result, stderr, output } = await run(filter, input, format);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, length);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

it("evaluates timeline enable separately for each frame", async () => {
  const { result, stderr, output } = await run("scharr=enable='eq(n,1)'", Buffer.concat([gray, gray]));
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(output.length, 512);
  assert.deepEqual(output.subarray(0, 256), gray);
  assert.equal(createHash("sha256").update(output.subarray(256)).digest("hex"), "86c32ff08ee48ee773ab6f216b63a5e4c7d53faaf70debf9047f0aa3f8258b9c");
});

for (const options of ["planes=-1", "planes=16", "scale=-1", "scale=65536", "delta=-65536", "delta=65536", "unknown=1"]) {
  it(`rejects invalid scharr ${options} before emitting output`, async () => {
    const { result, stderr, output } = await run(`scharr=${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /scharr/);
    assert.equal(output.length, 0);
  });
}
