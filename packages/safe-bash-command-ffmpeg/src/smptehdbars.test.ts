import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: smptehdbars=s=WIDTHx48:r=1:d=1 -pix_fmt yuv420p -f rawvideo.
for (const [width, hash, levels, barWidth, margin] of [
  [140, "a2ac881295661dcca2859af0b2ce9e26254bb623fe8a01eee4c1b732c2e6118f", 65, 16, 18],
  [64, "2499295b555cc27b24002a5fb898b196aa83ef961e9e8e4a0a8026b33de67e4e", 36, 6, 8]
] as const) {
  it(`renders native HD bars, ramp, and reference patches at ${width}x48`, async () => {
    const bytes = await run(`smptehdbars=s=${width}x48:r=1:d=1`);
    const lumaSize = width * 48;
    assert.equal(bytes.length, lumaSize * 3 / 2);
    assert.deepEqual([...bytes.subarray(0, width)], [
      ...Array<number>(margin).fill(104),
      ...[180, 168, 145, 133, 63, 51, 28].flatMap(y => Array<number>(barWidth).fill(y)),
      ...Array<number>(width - margin - barWidth * 7).fill(104)
    ]);
    assert.equal(new Set(bytes.subarray(0, lumaSize)).size, levels);
    assert.equal(new Set(bytes.subarray(lumaSize, lumaSize * 5 / 4)).size, 13);
    assert.equal(new Set(bytes.subarray(lumaSize * 5 / 4)).size, 13);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  });
}

it("repeats the static HD pattern with long source option names", async () => {
  const bytes = await run("smptehdbars=size=64x48:rate=2:duration=1");
  const frameSize = 64 * 48 * 3 / 2;
  assert.equal(bytes.length, 2 * frameSize);
  assert.equal(createHash("sha256").update(bytes.subarray(0, frameSize)).digest("hex"),
    "2499295b555cc27b24002a5fb898b196aa83ef961e9e8e4a0a8026b33de67e4e");
  assert.deepEqual(bytes.subarray(frameSize), bytes.subarray(0, frameSize));
});

async function run(source: string) {
  const volume = Volume.fromJSON({});
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "lavfi", "-i", source,
      "-c:v", "rawvideo", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"],
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
  assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
  assert.equal(Buffer.concat(stderr).toString(), "");
  return Buffer.concat(stdout);
}
