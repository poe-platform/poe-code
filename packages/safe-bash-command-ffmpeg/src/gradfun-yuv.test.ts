import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(format: string, width: number, height: number, filter: string, maxMemoryBytes?: number) {
  const chromaWidth = format === "yuv444p" ? width : Math.ceil(width / 2);
  const chromaHeight = format === "yuv420p" ? Math.ceil(height / 2) : height;
  const sizes = [width * height, chromaWidth * chromaHeight, chromaWidth * chromaHeight];
  const input = Buffer.concat(sizes.map((size, plane) => {
    const planeWidth = plane === 0 ? width : chromaWidth;
    return Buffer.from(Array.from({ length: size }, (_, i) =>
      50 + 20 * plane + 2 * Math.floor((i % planeWidth) / 3) + Math.floor(i / planeWidth / 4)));
  }));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxMemoryBytes } }).execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", `${width}x${height}`, "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { ...result, stderr, input, sizes, output: volume.readFileSync("/out.raw") as Buffer };
}

// Complete raw-output hashes and per-plane changed-sample counts from FFmpeg 7.0.2.
for (const [format, width, height, radius, hash, changes] of [
  ["yuv444p", 32, 32, 4, "4415901eba944e9c2253426d49b9b6f2e14836198eb184e0b0561c29b639da50", [724, 724, 724]],
  ["yuv420p", 32, 32, 4, "e755f92090c9eb291c10604c5a6235fa7088c43324f5936d0782c5e20cd6d35f", [724, 198, 198]],
  ["yuv422p", 32, 32, 4, "212699dcd7ce0d609b453de47a56fc97d01ba897990850cd9331a0f3b2a1567e", [724, 404, 404]],
  ["yuv420p", 35, 37, 5, "b6734da311a0cbf991a7308210d937799f91ce05082dcb7d80fb51326d6febce", [1009, 258, 258]],
  ["yuv422p", 67, 69, 16, "060a0f8478f884e8fc05c6aa93420878cb31516c1ab0d92f6675ccdbf7cc59bc", [3170, 1709, 1709]],
  ["yuv420p", 16, 16, 4, "d89e3d86e092cf3c3e5563ade31565e05e7240e799eed88bde89230a5942c17d", [198, 0, 0]],
  ["yuv420p", 8, 8, 4, "b05ff4fcaa5a4196150542ba02fef0274677f1efb3d34940f5fab97fe74f1121", [0, 0, 0]],
  ["yuv420p", 64, 64, 16, "3fcbdd5e79ec48eb5b239ef41949048204be10e91a5143266c04b69c0efb805b", [2842, 830, 830]]
] as const) {
  it(`matches native ${format} gradfun at ${width}x${height}, radius ${radius}`, async () => {
    const result = await run(format, width, height, `gradfun=strength=5:radius=${radius}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, result.input.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    let offset = 0;
    for (const [plane, size] of result.sizes.entries()) {
      assert.equal(result.output.subarray(offset, offset + size)
        .filter((value, i) => value !== result.input[offset + i]).length, changes[plane], `plane ${plane}`);
      offset += size;
    }
  });
}

for (const format of ["yuv444p", "yuv420p", "yuv422p"]) {
  for (const filter of ["null", "gradfun=5:4:enable=0", "gradfun=5:32"]) {
    it(`preserves every ${format} plane with ${filter}`, async () => {
      const result = await run(format, 32, 32, filter);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, result.input);
    });
  }
}

it("preserves the destination when planar gradfun exceeds its memory budget", async () => {
  const control = await run("yuv444p", 32, 32, "null", 7000);
  assert.equal(control.exitCode, 0, control.stderr);
  const result = await run("yuv444p", 32, 32, "gradfun=5:4", 7000);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /memory/i);
  assert.equal(result.output.toString(), "KEEP");
});
