import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 1024 }, (_, i) =>
  (i % 32 < 16 ? 55 : 170) + (i % 32 + 2 * Math.floor(i / 32)) % 7));

async function run(filter: string, pipe = false) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  let stderr = "";
  const stdout: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "32x32",
      "-framerate", "4", "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", pipe ? "pipe:1" : "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { result, stderr, output: pipe ? Buffer.concat(stdout) : volume.existsSync("/out.raw") ? volume.readFileSync("/out.raw") as Buffer : undefined };
}

for (const [options, hash] of [
  ["1:0.5:3", "26ea172d0b505878c75acb4c40d20ff93b7c2fbe329c7c5685ccc7a5f23603b2"],
  ["luma_radius=1:luma_strength=0.5:luma_threshold=3", "26ea172d0b505878c75acb4c40d20ff93b7c2fbe329c7c5685ccc7a5f23603b2"],
  ["lr=1:ls=1:lt=-3", "9eafdf7474f754ba933f9f29c84861b9d8a32573dcdcf1fd05190140a2ba8e6a"],
  ["1:1:-3", "9eafdf7474f754ba933f9f29c84861b9d8a32573dcdcf1fd05190140a2ba8e6a"]
]) {
  it(`matches native grayscale smartblur=${options}`, async () => {
    const { result, stderr, output } = await run(`smartblur=${options}`, true);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output!.length, 1024);
    assert.equal(createHash("sha256").update(output!).digest("hex"), hash);
  });
}

for (const filter of ["null", "smartblur=1:0:3", "smartblur=0.1:1:-3", "smartblur=1:0.5:3:enable=0"]) {
  it(`preserves pixels for ${filter}`, async () => {
    const { result, stderr, output } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(output, input);
  });
}
for (const options of ["0:1:3", "6:1:3", "1:2:3", "1:-2:3", "1:1:31", "1:1:-31", "1:1:1.5", "unknown=1"]) {
  it(`rejects invalid smartblur options ${options}`, async () => {
    const { result, stderr, output } = await run(`smartblur=${options}`);
    assert.equal(result.exitCode, 1);
    assert.match(stderr, /smartblur/);
    assert.equal(output, undefined);
  });
}
