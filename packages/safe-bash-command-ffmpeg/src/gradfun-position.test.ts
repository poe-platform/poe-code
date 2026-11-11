import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frame = Buffer.from(Array.from({ length: 1024 }, (_, i) =>
  50 + 2 * Math.floor((i % 32) / 3) + Math.floor(i / 32 / 4)));
const input = Buffer.concat([frame, frame, frame]);

async function render(filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "32x32", "-framerate", "4", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
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
  assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return Buffer.concat(stdout);
}

for (const graph of [false, true]) {
  it(`gradfun selects the source packet at byte 1024 (${graph ? "graph" : "simple"})`, async () => {
    const control = await render("gradfun=strength=5:radius=4:enable='eq(n,1)'", graph);
    // Complete raw stdout from native FFmpeg 7.0.2 for this three-frame fixture.
    assert.equal(control.length, 3072);
    assert.equal(createHash("sha256").update(control).digest("hex"),
      "3ae9ccfa3ececfa4d71344fbb1a9e0df469cfe54842e728434d5c6c5afad3700");
    const output = await render("gradfun=strength=5:radius=4:enable='eq(pos,1024)'", graph);
    assert.deepEqual(output, control);
    assert.deepEqual(output.subarray(0, 1024), frame);
    assert.notDeepEqual(output.subarray(1024, 2048), frame);
    assert.deepEqual(output.subarray(2048), frame);
  });
}

it("gradfun retains source packet positions after frame selection and timestamp changes", async () => {
  const control = await render("gradfun=5:4:enable='eq(n,1)'");
  const output = await render("select='eq(n,1)',setpts=PTS-STARTPTS,gradfun=5:4:enable='eq(pos,1024)'");
  assert.deepEqual(output, control.subarray(1024, 2048));
});

it("gradfun exposes zero as a known source packet position", async () => {
  assert.deepEqual(await render("gradfun=5:4:enable='eq(pos,0)'"),
    await render("gradfun=5:4:enable='eq(n,0)'"));
  assert.deepEqual(await render("gradfun=5:4:enable='isnan(pos)'"), input);
});
