import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const luma = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
  [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200],
  [80, 80, 80, 80], [16, 16, 16, 16]];
const frames = luma.map(values => Buffer.from([...values, ...Array<number>(8).fill(128)]));
async function run(filter: string, level = "info") {
  const volume = Volume.fromJSON({ "/o.raw": "KEEP", "/stats.log": "KEEP" });
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
  assert.equal(volume.readFileSync("/stats.log", "utf8"), "KEEP");
  return { result, output: volume.readFileSync("/o.raw") as Buffer, error: Buffer.concat(errors).toString() };
}

// Native FFmpeg 7.0.2 reference: all eight frames remain byte-for-byte intact.
for (const filter of [
  "signalstats,metadata=delete:key=lavfi.signalstats.YMIN,metadata=mode=print:key=lavfi.signalstats.YMIN",
  "signalstats,metadata=delete,metadata=mode=print:key=lavfi.signalstats.YMIN",
  "signalstats,metadata=mode=delete,metadata=print",
  "signalstats,metadata=mode=delete:key=LAVFI.signalstats.ymin,metadata=print:key=lavfi.signalstats.YMIN",
  "metadata=delete,metadata=print",
  "metadata=delete:key=absent,metadata=print"
]) {
  it(`deletes frame metadata without changing video: ${filter}`, async () => {
    const { result, output, error } = await run(filter);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(output, Buffer.concat(frames));
    assert.equal(createHash("sha256").update(output).digest("hex"),
      "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
    assert.equal(error, "");
  });
}
for (const key of ["lavfi.signalstats.YMIN", "absent", ""]) {
  it(`preserves other keys and timestamps when deleting key=${key}`, async () => {
    const { result, output, error } = await run(`signalstats,metadata=delete:key=${key},metadata=print:key=lavfi.signalstats.UMIN`);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(output, Buffer.concat(frames));
    assert.equal(error, frames.map((_, n) =>
      `frame:${n} pts:${n} pts_time:${n / 4}\nlavfi.signalstats.UMIN=128\n`).join(""));
  });
}
it("prints signalstats values before deletion", async () => {
  const { result, output, error } = await run("signalstats,metadata=print:key=lavfi.signalstats.YMIN,metadata=delete,metadata=print");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat(frames));
  assert.equal(error, luma.map((values, n) =>
    `frame:${n} pts:${n} pts_time:${n / 4}\nlavfi.signalstats.YMIN=${Math.min(...values)}\n`).join(""));
});
it("deletes successfully with logging disabled", async () => {
  const { result, output, error } = await run("signalstats,metadata=delete:key=lavfi.signalstats.YMIN,metadata=print:key=lavfi.signalstats.YMIN", "error");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat(frames));
  assert.equal(error, "");
});
it("rejects unsupported deletion options before replacing output", async () => {
  const { result, output } = await run("signalstats,metadata=delete:unknown=1");
  assert.notEqual(result.exitCode, 0);
  assert.equal(output.toString(), "KEEP");
});
