import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, input: Buffer, pixelFormat = "gray") {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const argumentValues = createCommandArguments([
    "-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", pixelFormat,
    "-video_size", "16x16", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
    "-fps_mode", "passthrough", "-pix_fmt", pixelFormat, "-bitexact", "-f", "rawvideo", "pipe:1"
  ]);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    command: "ffmpeg", args: argumentValues.args, argumentValues,
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = Buffer.concat(chunks);
  assert.equal(output.length, input.length);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return output;
}

it("matches native FFmpeg when a repeated plane threshold resets to default", async () => {
  const input = Buffer.from(Array.from({ length: 256 }, (_, i) =>
    96 + 2 * Math.floor((i % 16) / 3) + Math.floor(Math.floor(i / 16) / 4)));
  const output = await run("deband=r=-3:d=-1:1thr=0.1:1thr=default", input);
  // Full rawvideo output from Linux FFmpeg 7.0.2.
  assert.equal(createHash("sha256").update(output).digest("hex"),
    "55f93c19c04617cdbb09c1d2d63e7dc728400a2a65ae0d967f5a4c500e6c6a41");
  assert.equal(output.filter((value, i) => value !== input[i]).length, 166);
  assert.equal(output[2], 97);
});

const colorInput = Buffer.from(Array.from({ length: 768 }, (_, i) =>
  60 + 20 * Math.floor(i / 256) + 12 * Math.floor((i % 16) / 3) + 2 * Math.floor(Math.floor((i % 256) / 16) / 4)));

for (const previous of [0.001, 0.1]) {
  it(`resets all plane thresholds from ${previous} to the declared default`, async () => {
    const initial = `deband=r=-3:d=-1:1thr=${previous}:2thr=${previous}:3thr=${previous}:4thr=${previous}`;
    const expected = await run("deband=r=-3:d=-1:1thr=0.02:2thr=0.02:3thr=0.02:4thr=0.02", colorInput, "yuv444p");
    assert.notDeepEqual(await run(initial, colorInput, "yuv444p"), expected);
    const output = await run(`${initial}:1thr=default:2thr=default:3thr=default:4thr=default`, colorInput, "yuv444p");
    assert.deepEqual(output, expected);
  });
}

for (const [expression, literal] of [["default", "0.02"], ["default/2", "0.01"]]) {
  it(`resolves positional plane threshold expression ${expression}`, async () => {
    const output = await run(`deband=${expression}:${expression}:${expression}:${expression}:-3:-1`, colorInput, "yuv444p");
    const expected = await run(`deband=${literal}:${literal}:${literal}:${literal}:-3:-1`, colorInput, "yuv444p");
    assert.deepEqual(output, expected);
  });
}
