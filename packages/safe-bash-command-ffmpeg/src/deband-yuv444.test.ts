import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 768 }, (_, i) =>
  60 + 20 * Math.floor(i / 256) + 3 * Math.floor((i % 16) / 3) + 2 * Math.floor(Math.floor((i % 256) / 16) / 4)));

async function run(filter: string, limits?: MediaResourceLimits) {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "yuv444p",
      "-video_size", "16x16", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-bitexact", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { ...result, output: volume.readFileSync("/out.raw") as Buffer, stderr: Buffer.concat(errors).toString() };
}

// Native FFmpeg 7.0.2 references cover every sample in all three planes.
for (const [filter, hash, changes] of [
  ["null", "b3fc72c504a70bb5c1697443d1cf6f33fe63bbf6e104a1e4e80326e537a34d24", 0],
  ["deband=r=-3:d=-1:1thr=0.1:2thr=0.001:3thr=0.1", "fc83d92b3fee6a561224061f36306766e97cfc5a2dd65ba6809b39a05e357c20", 404],
  ["deband=r=-3:d=-1:1thr=0.1:2thr=0.1:3thr=0.1", "d27e58ea3d97247907aa4c62185565cab2a7ae6e50c5dffce64b46942c00dc13", 606],
  ["deband=0.1:0.001:0.1:0.02:-3:-1", "fc83d92b3fee6a561224061f36306766e97cfc5a2dd65ba6809b39a05e357c20", 404],
] as const) {
  it(`matches native YUV444P ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    assert.equal(result.output.filter((value, i) => value !== input[i]).length, changes);
  });
}

for (const blur of [0, 1]) {
  it(`applies each YUV plane threshold independently with blur=${blur}`, async () => {
    const smoothed = await run(`deband=r=-3:d=-1:1thr=0.1:2thr=0.1:3thr=0.1:b=${blur}`);
    assert.equal(smoothed.exitCode, 0, smoothed.stderr);
    for (let disabled = 0; disabled < 3; disabled++) {
      const thresholds = [0, 1, 2].map(plane => `${plane + 1}thr=${plane === disabled ? 0.001 : 0.1}`).join(":");
      const result = await run(`deband=r=-3:d=-1:${thresholds}:b=${blur}`);
      assert.equal(result.exitCode, 0, result.stderr);
      for (let plane = 0; plane < 3; plane++) {
        const start = plane * 256;
        const actual = result.output.subarray(start, start + 256);
        assert.deepEqual(actual, (plane === disabled ? input : smoothed.output).subarray(start, start + 256));
        if (plane !== disabled) assert.notDeepEqual(actual, input.subarray(start, start + 256));
      }
    }
  });
}

it("preserves the destination when color debanding exceeds the memory budget", async () => {
  const limits = { maxMemoryBytes: 1791 };
  const control = await run("null", limits);
  assert.equal(control.exitCode, 0, control.stderr);
  const result = await run("deband=r=-3:d=-1:1thr=0.1:2thr=0.1:3thr=0.1", limits);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /memory/i);
  assert.equal(result.output.toString(), "KEEP");
});
