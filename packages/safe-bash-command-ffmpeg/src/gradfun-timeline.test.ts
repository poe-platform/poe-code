import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frame = Buffer.from(Array.from({ length: 1024 }, (_, i) =>
  50 + 2 * Math.floor((i % 32) / 3) + Math.floor(i / 128)));
const input = Buffer.concat([frame, frame, frame]);

async function run(filter: string) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "32x32", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
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
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return Buffer.concat(chunks);
}

it("preserves gradfun timeline registers across both evaluations of every frame", async () => {
  const control = await run("gradfun=5:4:enable='eq(n,0)'");
  const output = await run("gradfun=5:4:enable='eq(st(0,ld(0)+1),2)'");
  assert.deepEqual(output, control);
  assert.equal(output.length, 3072);
  // Complete stdout from native FFmpeg 7.0.2, including the first evaluation.
  assert.equal(createHash("sha256").update(output).digest("hex"),
    "0c586186ae667e8cb5f34f18cdd7117c50c7860760306ebca7bd89658bc02e8b");
  assert.equal(output.filter((byte, i) => byte !== input[i]).length, 724);
  assert.notDeepEqual(output.subarray(0, 1024), frame);
  assert.deepEqual(output.subarray(1024), input.subarray(1024));
  const later = await run("gradfun=5:4:enable='eq(st(0,ld(0)+1),4)'");
  assert.deepEqual(later, Buffer.concat([frame, output.subarray(0, 1024), frame]));
});

it("isolates gradfun timeline registers between filter instances and executions", async () => {
  const filter = "gradfun=5:4:enable='eq(st(0,ld(0)+1),2)'";
  const control = await run("gradfun=5:4:enable='eq(n,0)',gradfun=5:4:enable='eq(n,0)'");
  assert.deepEqual(await run(`${filter},${filter}`), control);
  assert.deepEqual(await run(`${filter},${filter}`), control);
});
