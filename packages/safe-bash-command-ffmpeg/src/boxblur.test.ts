import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 1024 }, (_, i) =>
  i === 0 || i === 528 ? 245 : 20));

async function run(filter: string) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "32x32",
      "-framerate", "4", "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { result, stderr, output: volume.existsSync("/out.raw") ? volume.readFileSync("/out.raw") as Buffer : undefined };
}

for (const [options, hash] of [
  ["2:1", "6e7baa36610343e8562d889cfcdeb26a012781c3d19111e40eb343216bd4a9d3"],
  ["2:2", "ac3e5a47f62fc77e7c324aecae79639d6b00d41d41752ad567512b0434a9cc4d"],
  ["luma_radius=2:luma_power=2", "ac3e5a47f62fc77e7c324aecae79639d6b00d41d41752ad567512b0434a9cc4d"],
  ["lr=2:lp=1", "6e7baa36610343e8562d889cfcdeb26a012781c3d19111e40eb343216bd4a9d3"]
]) {
  it(`matches native grayscale boxblur=${options}`, async () => {
    const { result, stderr, output } = await run(`boxblur=${options}`);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output!.length, 1024);
    assert.equal(createHash("sha256").update(output!).digest("hex"), hash);
  });
}
for (const filter of ["null", "boxblur=0:2", "boxblur=2:0", "boxblur=2:2:enable=0"]) {
  it(`preserves pixels for ${filter}`, async () => {
    const { result, stderr, output } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(output, input);
  });
}
for (const options of ["-1:1", "17:1", "2:-1", "unknown=1"]) {
  it(`rejects invalid boxblur options ${options}`, async () => {
    const { result, stderr, output } = await run(`boxblur=${options}`);
    assert.equal(result.exitCode, 1);
    assert.match(stderr, /boxblur/);
    assert.equal(output, undefined);
  });
}
