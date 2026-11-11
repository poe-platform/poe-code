import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, format: string, options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "2x2",
      "-framerate", "1", "-i", "/in.raw", "-vf", "null", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { ...result, stderr, output: Buffer.concat(stdout) };
}

const packed = Buffer.from("500a285a1432641e3c6e2846", "hex");
// Native FFmpeg 7.0.2: a full green plane, then blue, then red.
const planar = Buffer.from("0a141e2828323c46505a646e", "hex");
for (const [format, expected] of [["gbrp", planar], ["rgb24", packed]] as const) {
  it(`matches native ${format} stdout for packed RGB through null`, async () => {
    const result = await run(packed, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.output, expected);
  });
}

it("writes G, B, R planes separately for each frame within the exact output limit", async () => {
  const input = Buffer.concat([packed, Buffer.from("040002fbfffd050103fafefc", "hex")]);
  const result = await run(input, "gbrp", { limits: { maxOutputBytes: 24 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.output, Buffer.concat([planar, Buffer.from("00ff01fe02fd03fc04fb05fa", "hex")]));
});

it("rejects GBRP output exceeding its byte limit without emitting partial output", async () => {
  const result = await run(packed, "gbrp", { limits: { maxOutputBytes: 11 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.length, 0);
});
