import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frame = Buffer.from(Array.from({ length: 48 }, (_, i) => {
  const x = i % 8;
  const y = Math.floor(i / 8);
  return x === 0 && y === 0 ? 245 : x === 3 && y === 2 ? 4 : (x * 37 + y * 29 + x * y * 3) % 251;
}));
const input = Buffer.concat([frame, frame, frame]);

async function run(filter: string) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "8x6", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = Buffer.concat(chunks);
  assert.equal(output.length, 144);
  return output;
}

it("matches the native median register timeline output including borders", async () => {
  const control = await run("median=enable='eq(n,0)'");
  assert.equal(createHash("sha256").update(control).digest("hex"),
    "99cac27eeb19b45fa5402f9b71c78d63bfc818a2c55895e546db7901d5655b42");
  assert.equal(control.subarray(0, 8).toString("hex"), "454a4a6f95b9b912");
  assert.deepEqual(await run("median=enable='eq(st(0,ld(0)+1),2)'"), control);
});

for (const [count, selected] of [[1, -1], [4, 1], [6, 2]] as const) {
  it(`retains median registers across disabled frames until evaluation ${count}`, async () => {
    const control = await run(`median=enable='eq(n,${selected})'`);
    assert.deepEqual(await run(`median=enable='eq(st(9,ld(9)+1),${count})'`), control);
  });
}

it("isolates median registers between filter instances and command executions", async () => {
  const control = await run("median@a=enable='eq(n,0)',median@b=enable='eq(n,0)'");
  const filter = "median@a=enable='eq(st(0,ld(0)+1),2)',median@b=enable='eq(st(0,ld(0)+1),2)'";
  assert.deepEqual(await run(filter), control);
  assert.deepEqual(await run(filter), control);
});
