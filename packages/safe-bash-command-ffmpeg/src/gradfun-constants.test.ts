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

it("matches native gradfun numeric control bytes", async () => {
  const result = await run("1.2:4");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.length, 1024);
  // Native FFmpeg 7.0.2, including all 205 changed pixels.
  assert.equal(createHash("sha256").update(result.output).digest("hex"),
    "19188aa0a3589b107474cd33e3552947a87d0b8f05a7d8a5efff6a7551d7d757");
  assert.equal(result.output.filter((value, index) => value !== input[index]).length, 205);
});

for (const [options, numeric] of [
  ["default:4", "1.2:4"],
  ["1.2:min", "1.2:4"],
  ["strength=default:radius=min", "1.2:4"],
  ["min:4", "0.51:4"],
  ["max:min", "64:4"],
  ["1.2:default", "1.2:16"],
  ["1.2:max", "1.2:32"],
  ["strength=default*2:radius=min+2", "2.4:6"],
  ["strength=max/2:radius=default/2", "32:8"]
] as const) {
  it(`resolves gradfun option constants in ${options}`, async () => {
    const control = await run(numeric);
    const result = await run(options);
    assert.equal(control.exitCode, 0, control.stderr);
    assert.equal(result.exitCode, control.exitCode, result.stderr);
    assert.deepEqual(result.output, control.output);
  });
}

for (const options of ["min-0.01:4", "max+1:4", "1.2:min-1", "1.2:max+1", "unknown:4"]) {
  it(`rejects invalid gradfun constant expressions ${options}`, async () => {
    const result = await run(options);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /gradfun/);
    assert.equal(result.output.length, 0);
  });
}
