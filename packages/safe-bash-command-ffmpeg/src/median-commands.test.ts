import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const frame = Buffer.from(Array.from({ length: 48 }, (_, i) => {
  const x = i % 8;
  const y = Math.floor(i / 8);
  return x === 0 && y === 0 ? 245 : x === 3 && y === 2 ? 4 : (x * 37 + y * 29 + x * y * 3) % 251;
}));
const input = Buffer.concat([frame, frame, frame]);

async function run(filter: string, bytes = input) {
  const volume = Volume.fromJSON({ "/in.raw": bytes });
  const argumentValues = createCommandArguments([
    "-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
    "-video_size", "8x6", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
    "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"
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
    stdout: { async write(data: Uint8Array) { chunks.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(volume.readFileSync("/in.raw"), bytes);
  const output = Buffer.concat(chunks);
  assert.equal(output.length, bytes.length);
  return output;
}

// Complete raw stdout references from Linux FFmpeg 7.0.2, including all borders.
for (const [filter, hash] of [
  ["median", "84df38549caef8249a24ce51291473cf729b3f2b1fe010046d7168583a836b5d"],
  ["median=percentile=1", "f07a3c884122f7e13a3ca7dda4c4aac62a7fbfde2ff6cde40b804b82e3bd687b"],
  ["sendcmd=c='0.25 median percentile 1',median", "9c7986f0f9d015308ba58885d0c9b8698947415f1992bc8a04d01e46b10447da"]
]) {
  it(`matches native grayscale stdout: ${filter}`, async () => {
    assert.equal(createHash("sha256").update(await run(filter!)).digest("hex"), hash);
  });
}

for (const [filter, expected] of [
  ["sendcmd=commands='0.26 [enter] median@v percentile max',median@v", ["median", "median", "median=percentile=1"]],
  ["sendcmd=c='0.5 median percentile default;0.25 median percentile 1',median", ["median", "median=percentile=1", "median"]],
  ["sendcmd=c='0.25 median percentile 1/4;0.5 median percentile min',median", ["median", "median=percentile=0.25", "median=percentile=0"]],
  ["sendcmd=c='0.25 median percentile 1;0.25 median percentile 0',median", ["median", "median=percentile=0", "median=percentile=0"]],
  ["sendcmd=c='0.25 median@other percentile 1;1 median percentile 1',median@v", ["median", "median", "median"]],
  ["sendcmd=c='0.25 median percentile 1',median@a,median@b", ["median,median", "median=percentile=1,median", "median=percentile=1,median"]],
  ["sendcmd=c='0.25 median@b percentile 1',median@a,median@b", ["median,median", "median,median=percentile=1", "median,median=percentile=1"]],
  ["sendcmd=c='0.25 median percentile 1',median=enable=gte(n\\,2)", ["null", "null", "median=percentile=1"]]
] as const) {
  it(`applies median commands at frame boundaries: ${filter}`, async () => {
    const output = await run(filter);
    assert.deepEqual(output, Buffer.concat(await Promise.all(expected.map(value => run(value, frame)))));
  });
}

for (const value of ["nope", "nan", "-0.1", "1.1"]) {
  it(`retains the active percentile after rejected command ${value}`, async () => {
    const output = await run(`sendcmd=c='0 median percentile 1;0.25 median percentile ${value};0.5 median percentile default',median`);
    const maximum = await run("median=percentile=1", frame);
    assert.deepEqual(output, Buffer.concat([maximum, maximum, await run("median", frame)]));
  });
}
