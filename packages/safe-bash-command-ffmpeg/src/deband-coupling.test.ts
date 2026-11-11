import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, source: Buffer, pixelFormat: string, limits?: MediaResourceLimits) {
  const volume = Volume.fromJSON({ "/in.gray": source, "/out": "KEEP" });
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", pixelFormat, "-s", "16x16", "-r", "4", "-i", "/in.gray",
      "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", pixelFormat, "-bitexact", "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { ...result, output: volume.readFileSync("/out") as Buffer, stderr: Buffer.concat(errors).toString() };
}

const gray = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  96 + 2 * Math.floor((i % 16) / 3) + Math.floor(Math.floor(i / 16) / 4)));
const yuv = Buffer.from(Array.from({ length: 768 }, (_, i) =>
  60 + 20 * Math.floor(i / 256) + 3 * Math.floor((i % 16) / 3) + 2 * Math.floor(Math.floor((i % 256) / 16) / 4)));

// Full-stream native FFmpeg reference hashes (issue cases use 7.0.2).
for (const [pixelFormat, source, options, hash] of [
  ["yuv444p", yuv, "1thr=0.1:2thr=0.001:3thr=0.1:c=1", "b3fc72c504a70bb5c1697443d1cf6f33fe63bbf6e104a1e4e80326e537a34d24"],
  ["yuv444p", yuv, "1thr=0.1:2thr=0.001:3thr=0.1:c=0", "fc83d92b3fee6a561224061f36306766e97cfc5a2dd65ba6809b39a05e357c20"],
  ["yuv444p", yuv, "1thr=0.1:2thr=0.1:3thr=0.1:coupling=1", "d27e58ea3d97247907aa4c62185565cab2a7ae6e50c5dffce64b46942c00dc13"],
  ["yuv444p", yuv, "1thr=0.1:2thr=0.01:3thr=0.1:c=1:b=0", "b3fc72c504a70bb5c1697443d1cf6f33fe63bbf6e104a1e4e80326e537a34d24"],
  ["yuv444p", yuv, "1thr=0.1:2thr=0.1:3thr=0.001:c=1", "b3fc72c504a70bb5c1697443d1cf6f33fe63bbf6e104a1e4e80326e537a34d24"],
  ["yuv444p", yuv, "1thr=0.001:2thr=0.1:3thr=0.1:c=0", "954681955d049de69dabeaf525d29615b2546d27d0b21e9e4065c208b8920681"],
  ["gray", gray, "1thr=0.1:c=1", "55f93c19c04617cdbb09c1d2d63e7dc728400a2a65ae0d967f5a4c500e6c6a41"],
  ["gray", gray, "1thr=0.1:c=0", "55f93c19c04617cdbb09c1d2d63e7dc728400a2a65ae0d967f5a4c500e6c6a41"],
] as const) {
  it(`matches native ${pixelFormat} deband ${options}`, async () => {
    const result = await run(`deband=r=-3:d=-1:${options}`, source, pixelFormat);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, source.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

it("accepts positional coupling and preserves planes through successive filters", async () => {
  const result = await run("deband=0.1:0.1:0.1:0.02:-3:-1:1:1,deband=r=-3:d=-1:2thr=0.001:c=1", yuv, "yuv444p");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(createHash("sha256").update(result.output).digest("hex"), "d27e58ea3d97247907aa4c62185565cab2a7ae6e50c5dffce64b46942c00dc13");
});

it("enforces the planar memory budget without replacing output", async () => {
  const result = await run("deband=c=1", yuv, "yuv444p", { maxMemoryBytes: 2048 });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.output.toString(), "KEEP");
});
