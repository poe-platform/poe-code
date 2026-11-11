import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = [40, 40, 100, 160, 200, 200, 240];

async function run(filter: string) {
  const fs = Volume.fromJSON({ "/in.raw": Buffer.from(input), "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "1x1", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: fs.readFileSync("/out.raw") };
}

for (const [filter, expected] of [
  ["thumbnail=n=3:enable='gte(n,3)',showinfo", [40, 40, 100, 200, 240]],
  ["thumbnail=3:enable='gte(t,0.75)'", [40, 40, 100, 200, 240]],
  ["thumbnail=n=3:enable=0", input],
  ["thumbnail=n=3:enable=1", [40, 200, 240]],
  ["thumbnail=n=3:log=quiet:enable=1", [40, 200, 240]],
  ["thumbnail=3:quiet:enable=1", [40, 200, 240]],
  ["thumbnail=n=3:enable=0.49", input],
  ["thumbnail=n=3:enable=-0.5", [40, 200, 240]],
  ["thumbnail=n=3:enable=NAN", input],
  ["thumbnail=n=3:enable='isnan(0/0)'", [40, 200, 240]],
  ["thumbnail=n=3:enable='gte(st(0,ld(0)+1),7)'", [40, 40, 100, 200, 240]],
  ["thumbnail=enable='gte(n,3)'", [40, 40, 100, 200]],
  ["thumbnail=n=3:enable='not(mod(n,2))'", [40, 160, 40, 200, 240]],
  ["thumbnail=n=3:enable='lt(n,2)'", [100, 160, 200, 200, 240, 40]],
  ["thumbnail=n=3:enable='gte(n,3)',select='eq(t,1)+eq(t,1.5)'", [200, 240]],
  ["thumbnail=n=3:enable='gte(n,3)',fps=4", [40, 40, 100, 100, 200, 200, 240]]
] as const) {
  it(`applies thumbnail only to enabled frames: ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.from(expected));
  });
}

for (const filter of [
  "thumbnail=n=3:enable='unknown(n)'",
  "select=0,thumbnail=n=3:enable='unknown(n)'",
  "thumbnail=3:quiet:4:enable=1"
]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const result = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /thumbnail/);
    assert.equal(result.output.toString(), "KEEP");
  });
}
