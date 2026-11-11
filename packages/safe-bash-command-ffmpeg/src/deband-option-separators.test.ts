import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  96 + 2 * Math.floor((i % 16) / 3) + Math.floor(Math.floor(i / 16) / 4)));

async function run(options: string, destination = "/out.raw") {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  const errors: Uint8Array[] = [];
  const stdout: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "16x16", "-framerate", "4", "-i", "/in.raw", "-vf", `deband=${options}`,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  const output = destination === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync("/out.raw") as Buffer;
  return { ...result, output, stderr: Buffer.concat(errors).toString() };
}

// Full-stream pixel hashes from native FFmpeg 7.0.2, including clipped borders.
for (const [options, smooth] of [
  ["r=-3:d=-1:1thr=0.1", true],
  ["r=-3:d=-1:1thr=0.1:", true],
  ["d=-1:r=-3:0.1", true],
  ["range=-3:direction=-1:0.1:", true],
  ["0.1:0.02:0.02:0.02:-3:-1:", true],
  ["r=-3:d=-1:1thr=0.001:0.1", false],
  ["r=-3:d=-1:2thr=0.001:0.1", true],
  ["0.001:r=-3:d=-1:0.1", false],
  ["r=-3:d=-1:0.001:1thr=0.1:0.001", false],
  ["r=-3:d=-1:1thr=0.001:1thr=0.001:0.1", true]
] as const) {
  for (const destination of ["/out.raw", "pipe:1"]) {
    it(`matches native deband option binding for ${options} to ${destination}`, async () => {
      const result = await run(options, destination);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, input.length);
      assert.equal(createHash("sha256").update(result.output).digest("hex"), smooth
        ? "55f93c19c04617cdbb09c1d2d63e7dc728400a2a65ae0d967f5a4c500e6c6a41"
        : "2eafbc5ef2454355618e2e6300fd94ae8dc97b84d4b7394ffd4a622a883679bd");
      assert.equal(result.output.filter((value, i) => value !== input[i]).length, smooth ? 166 : 0);
    });
  }
}

for (const options of [
  "r=-3:d=-1:1thr=0.1::",
  "r=-3:d=-1::0.1",
  "r=-3:d=-1:1thr=",
  "r=-3:d=-1:0.1:0.02:0.02:0.02:-3:-1:1:0:0"
]) {
  it(`rejects empty or surplus deband values in ${options} without replacing output`, async () => {
    const result = await run(options);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  });
}
