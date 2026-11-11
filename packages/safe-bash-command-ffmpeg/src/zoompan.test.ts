import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = [10, 30, 60, 90, 120, 150, 180, 210];
async function run(filter: string, format = "rawvideo", limits?: MediaResourceLimits) {
  const volume = Volume.fromJSON({ "/in.gray": Buffer.from([...input, ...input]), "/out": "KEEP" });
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "4x2", "-r", "4", "-i", "/in.gray",
      "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", format, "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { ...result, output: volume.readFileSync("/out") as Buffer, stderr: Buffer.concat(errors).toString() };
}

for (const [filter, expected] of [
  ["null", [...input, ...input]],
  ["zoompan=z=2:x=on:y=0:d=2:s=2x1:fps=4", [10, 30, 30, 60, 60, 90, 60, 90]],
  ["zoompan=2:on:0:2:2x1:4", [10, 30, 30, 60, 60, 90, 60, 90]],
  ["zoompan=zoom=2:x=frame:y=in:d=2:s=2x1:fps=4", [10, 30, 30, 60, 120, 150, 150, 180]],
  ["zoompan=z=2:x=px+frame:d=in+2:s=2x1:fps=4", [10, 30, 30, 60, 30, 60, 60, 90, 60, 90]],
  ["zoompan=z='if(in,pzoom,2)':x=on:d=2:s=2x1:fps=4", [10, 30, 30, 60, 60, 90, 60, 90]],
  ["zoompan=z=2:x=frame:d=pduration+1:s=2x1:fps=4", [10, 30, 10, 30, 30, 60]],
  ["zoompan=z=2:x=ot*4:d=2:s=2x1:fps=4", [10, 30, 30, 60, 60, 90, 60, 90]],
  ["zoompan=z=2:x=x+0.5:d=3:s=2x1", [10, 30, 30, 60, 30, 60, 10, 30, 30, 60, 30, 60]],
  ["zoompan=z=2:d=0:s=2x1", [10, 30, 10, 30]],
  ["zoompan=z=2:x=on:d=2:s=4x2:fps=4", [10, 10, 30, 30, 10, 10, 30, 30,
    30, 30, 60, 60, 30, 30, 60, 60, 60, 60, 90, 90, 60, 60, 90, 90, 60, 60, 90, 90, 60, 60, 90, 90]],
  ["zoompan=z=2:x=-10:y=100:d=1:s=2x1", [120, 150, 120, 150]],
  ["zoompan=z=2:x=on:d=2:s=2x1:fps=4,trim=start=0.5", [60, 90, 60, 90]],
] as const) {
  it(`renders native zoompan pixels for ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual([...result.output], expected);
  });
}

it("emits four quarter-second zoompan frames on a fresh timeline", async () => {
  const result = await run("setpts=PTS+8,zoompan=z=2:x=on:d=2:s=2x1:fps=4", "framemd5");
  assert.equal(result.exitCode, 0, result.stderr);
  const lines = result.output.toString().split("\n");
  assert.ok(lines.includes("#tb 0: 1/4"), result.output.toString());
  assert.deepEqual(lines.filter(line => line.startsWith("0,")).map(line =>
    line.split(",").slice(1, 5).map(value => Number(value.trim()))),
  [[0, 0, 1, 2], [1, 1, 1, 2], [2, 2, 1, 2], [3, 3, 1, 2]]);
});

for (const [options, limits] of [
  ["z=2:d=100:s=2x1", { maxFrames: 8 }],
  ["z=2:d=100:s=2x1", { maxDurationSeconds: 1 }],
  ["s=100x100:d=1", { maxPixelsPerFrame: 16 }],
  ["s=100x100:d=1", { maxMemoryBytes: 4096 }],
  ["unknown=2"], ["fps=0"], ["s=0x1"], ["z=unknown"], ["d=2147483648"],
] as readonly (readonly [string, MediaResourceLimits?])[]) {
  it(`rejects invalid or over-budget zoompan ${options} ${JSON.stringify(limits)}`, async () => {
    const result = await run(`zoompan=${options}`, "rawvideo", limits);
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}
