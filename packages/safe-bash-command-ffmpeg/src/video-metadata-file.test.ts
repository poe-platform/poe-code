import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const report = `frame:0    pts:0       pts_time:0
lavfi.signalstats.YMIN=16
frame:1    pts:1       pts_time:0.25
lavfi.signalstats.YMIN=16
frame:2    pts:2       pts_time:0.5
lavfi.signalstats.YMIN=16
frame:3    pts:3       pts_time:0.75
lavfi.signalstats.YMIN=200
frame:4    pts:4       pts_time:1
lavfi.signalstats.YMIN=200
frame:5    pts:5       pts_time:1.25
lavfi.signalstats.YMIN=200
frame:6    pts:6       pts_time:1.5
lavfi.signalstats.YMIN=80
frame:7    pts:7       pts_time:1.75
lavfi.signalstats.YMIN=16
`;

async function run(options: string, level = "info", key = "lavfi.signalstats.YMIN") {
  const frames = [[16,16,16,16], [16,16,16,32], [16,16,16,16], ...[200,200,200,80,16].map(y => [y,y,y,y])];
  const volume = Volume.fromJSON({ "/stats.log": "KEEP", "/o.raw": "KEEP" });
  volume.writeFileSync("/in.y4m", Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
    ...frames.map(ys => Buffer.concat([Buffer.from("FRAME\n"), Buffer.from([...ys, ...Array<number>(8).fill(128)])]))]));
  let stderr = "", stdout = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", level, "-y", "-i", "in.y4m", "-vf",
      `signalstats,metadata=print:key=${key}${options}`, "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "o.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    }, stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, volume, stderr, stdout };
}

for (const [options, level] of [[":file=stats.log", "info"], [":file=stats.log:direct=1", "error"], [":file=stats.log:direct=false", "error"], ["", "info"], ["", "error"], [":file=-", "error"]]) {
  it(`routes video metadata ${options} at ${level} without changing video`, async () => {
    const result = await run(options!, level);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = result.volume.readFileSync("/o.raw") as Buffer;
    assert.equal(output.length, 96);
    assert.equal(createHash("sha256").update(output).digest("hex"), "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
    assert.equal(Buffer.byteLength(report), 499);
    assert.equal(result.volume.readFileSync("/stats.log", "utf8"), options!.includes("file=stats.log") ? report : "KEEP");
    assert.equal(result.stdout, options === ":file=-" ? report : "");
    if (!options && level === "info") assert.ok(result.stderr.includes(report), result.stderr);
    else assert.ok(!result.stderr.includes("frame:"), result.stderr);
  });
}
it("truncates the metadata file when no selected tags match", async () => {
  const result = await run(":file=stats.log", "error", "missing");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.volume.readFileSync("/stats.log", "utf8"), "");
});
it("rejects invalid direct before replacing outputs", async () => {
  const result = await run(":file=stats.log:direct=invalid");
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("metadata: invalid direct"), result.stderr);
  assert.equal(result.volume.readFileSync("/stats.log", "utf8"), "KEEP");
  assert.equal(result.volume.readFileSync("/o.raw", "utf8"), "KEEP");
});
