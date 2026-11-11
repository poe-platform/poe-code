import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frame = Buffer.from(Array.from({ length: 1024 }, (_, i) =>
  50 + 2 * Math.floor((i % 32) / 3) + Math.floor(i / 32 / 4)));
const input = Buffer.concat([frame, frame, frame]);

async function render(enable: string, graph: boolean) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const filter = `gradfun=strength=5:radius=4:enable='${enable}'`;
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
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { result, stderr, output: Buffer.concat(stdout) };
}

for (const graph of [false, true]) {
  for (const enable of ["0", "0/0", "abs(0/0)", "sqrt(-1)"]) {
    it(`gradfun bypasses enable=${enable} (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await render(enable, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(output, input);
      // Complete stdout from the three-frame native FFmpeg 7.0.2 reproduction.
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "b340951ffe24ac58834e6510ae7a7acebd4246f72bfea02686ef68c76f350ca1");
    });
  }

  it(`gradfun evaluates NaN enable per frame (${graph ? "graph" : "simple"})`, async () => {
    const control = await render("eq(n,1)", graph);
    assert.equal(control.result.exitCode, 0, control.stderr);
    assert.notDeepEqual(control.output.subarray(1024, 2048), frame);
    for (const enable of ["if(eq(n,1),1,0/0)", "if(eq(t,0.25),1/0,0/0)"]) {
      const { result, stderr, output } = await render(enable, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(output, control.output);
      assert.deepEqual(output.subarray(0, 1024), frame);
      assert.deepEqual(output.subarray(2048), frame);
    }
  });

  it(`gradfun still rejects malformed enable expressions (${graph ? "graph" : "simple"})`, async () => {
    for (const enable of ["unknown(0/0)", "abs(0/0", "0/0junk"]) {
      const { result, stderr, output } = await render(enable, graph);
      assert.equal(result.exitCode, 1);
      assert.ok(stderr.includes("gradfun enable"), stderr);
      assert.equal(output.length, 0);
    }
  });
}
