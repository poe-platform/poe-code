import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, source = "gbrp", target = "rgb24", options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", source, "-video_size", "2x2",
      "-framerate", "1", "-i", "/in.raw", "-vf", "null", "-pix_fmt", target, "-f", "rawvideo", "pipe:1"],
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

// Native FFmpeg 7.0.2 reference: G, B, R planes become packed RGB.
const planar = Buffer.from("0a141e2828323c46505a646e", "hex");
const packed = Buffer.from("500a285a1432641e3c6e2846", "hex");
for (const [format, input] of [["gbrp", planar], ["rgb24", packed]] as const) {
  it(`matches native RGB24 stdout for ${format} input through null`, async () => {
    const result = await run(input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.output, packed);
  });
}

it("decodes each GBRP frame independently and adds opaque alpha", async () => {
  const input = Buffer.concat([planar, Buffer.from("00ff01fe02fd03fc04fb05fa", "hex")]);
  const result = await run(input, "gbrp", "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.output.toString("hex"), "500a28ff5a1432ff641e3cff6e2846ff040002fffbfffdff050103fffafefcff");
});

for (const limits of [{ maxFrames: 0 }, { maxSamplesPerTrack: 0 }, { maxMemoryBytes: 1 }, { maxOutputBytes: 11 }]) {
  it(`enforces GBRP resource limits before emitting output: ${JSON.stringify(limits)}`, async () => {
    const result = await run(planar, "gbrp", "rgb24", { limits });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Resource limit exceeded/);
    assert.equal(result.output.length, 0);
  });
}
