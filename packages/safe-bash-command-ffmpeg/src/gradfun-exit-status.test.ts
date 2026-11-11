import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 1024 }, (_, i) =>
  50 + 2 * Math.floor((i % 32) / 3) + Math.floor(i / 32 / 4)));

async function run(options: string) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "32x32", "-framerate", "4", "-i", "/in.raw", "-vf", `gradfun=${options}`,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { exitCode: result.exitCode, output: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

// Native FFmpeg 7.0.2: EINVAL, ERANGE, and option-not-found shell statuses.
for (const [options, exitCode] of [
  ["strength=bad", 234], ["radius=bad", 234], ["5:3", 222],
  ["strength=0.5", 222], ["strength=65", 222], ["radius=33", 222],
  ["badkey=1", 8], ["5:4:1", 234]
] as const) {
  it(`gradfun=${options} returns native status ${exitCode} with empty stdout`, async () => {
    const result = await run(options);
    assert.equal(result.exitCode, exitCode, result.stderr);
    assert.equal(result.output.length, 0);
    assert.match(result.stderr, /gradfun/);
  });
}

it("preserves native gradfun output for valid options", async () => {
  const result = await run("strength=5:radius=4");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.length, 1024);
  assert.equal(createHash("sha256").update(result.output).digest("hex"),
    "f021f8f8032267309cd2b854e7c8b457db230bb5f9d95d11431579039b46c3d0");
  assert.equal(result.output.filter((value, index) => value !== input[index]).length, 724);
});
