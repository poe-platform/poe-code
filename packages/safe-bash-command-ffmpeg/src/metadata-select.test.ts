import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const planes = [[16,16,16,16], [16,16,16,32], [16,16,16,16],
  [200,200,200,200], [200,200,200,200], [200,200,200,200], [80,80,80,80], [16,16,16,16]];
const frames = planes.map(y => Buffer.from([...y, ...Array<number>(8).fill(128)]));
async function run(filter: string, level = "info") {
  const volume = Volume.fromJSON({ "/o.raw": "KEEP" });
  volume.writeFileSync("/in.y4m", Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", level, "-y", "-i", "in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "o.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    }, stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, output: volume.readFileSync("/o.raw"), error: Buffer.concat(errors).toString() };
}

for (const options of ["select:key=lavfi.signalstats.YMIN:value=200",
  "mode=select:key=lavfi.signalstats.YMIN:value=100:function=greater"]) {
  it(`selects the three native reference frames with ${options}`, async () => {
    const { result, output, error } = await run(`signalstats,metadata=${options},metadata=print:key=lavfi.signalstats.YMIN`);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(output, Buffer.concat(frames.slice(3, 6)));
    assert.equal(createHash("sha256").update(output).digest("hex"), "2055391d17d9ef79fc6eadd7440cbbd2fa35ce6034141d829fa7aed7a5bfca0d");
    for (const time of [0.75, 1, 1.25]) assert.ok(error.includes(`pts_time:${time}\n`), error);
  });
}
for (const [filter, indices] of [
  ["metadata=select:key=nonexistent", []],
  ["signalstats,metadata=select:key=nonexistent:value=100:function=greater", []],
  ["signalstats,metadata=select:key=lavfi.signalstats.YMIN", [0,1,2,3,4,5,6,7]],
  ["signalstats,metadata=select:key=lavfi.signalstats.YMIN:value=0200", []],
  ["signalstats,metadata=select:key=lavfi.signalstats.YMIN:value=200:function=greater", []],
  ["signalstats,metadata=select:key=lavfi.signalstats.YMIN:value=80:function=greater", [3,4,5]],
  ["signalstats,metadata=print:key=lavfi.signalstats.YMIN", [0,1,2,3,4,5,6,7]]
] as const) {
  it(`matches selection independently of logging: ${filter}`, async () => {
    const { result, output, error } = await run(filter, "error");
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(output, Buffer.concat(indices.map(i => frames[i]!)));
  });
}
for (const [options, exitCode] of [
  ["select", 1], ["select:value=200", 1],
  ["select:key=x:function=invalid", 1], ["select:key=x:unknown=1", 8]
] as const) {
  it(`rejects invalid metadata options without replacing output: ${options}`, async () => {
    const { result, output } = await run(`metadata=${options}`);
    assert.equal(result.exitCode, exitCode);
    assert.equal(output.toString(), "KEEP");
  });
}
