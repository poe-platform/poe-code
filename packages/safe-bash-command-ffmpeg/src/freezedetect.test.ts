import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { freezedetect } from "./freezedetect.js";
import { createFfmpegCommand } from "./index.js";

const luma = [[16,16,16,16], [16,16,16,32], [16,16,16,16],
  [200,200,200,200], [200,200,200,200], [200,200,200,200], [80,80,80,80], [16,16,16,16]];
const samples = luma.map(ys => [...ys, ...Array<number>(8).fill(128)]);

async function run(filter: string, frames = samples, level = "info") {
  const volume = Volume.fromJSON({ "/o.raw": "KEEP", "/stats.log": "KEEP" });
  volume.writeFileSync("/in.y4m", Buffer.concat([
    Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), Buffer.from(frame)])
  ]));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", level, "-y", "-i", "in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "o.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(volume.readFileSync("/stats.log", "utf8"), "KEEP");
  return { result, output: volume.readFileSync("/o.raw") as Buffer, error: Buffer.concat(errors).toString() };
}

it("reports freeze intervals on the threshold and first changed frames without changing samples", async () => {
  const { result, output, error } = await run("freezedetect=n=0:d=0.5,metadata=print");
  assert.equal(result.exitCode, 0, error);
  assert.equal(output.length, 96);
  assert.equal(createHash("sha256").update(output).digest("hex"), "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
  for (const line of ["freeze_start: 0.75", "freeze_duration: 0.75", "freeze_end: 1.5"]) {
    assert.ok(error.includes(`lavfi.freezedetect.${line}\n`), error);
  }
  const records = error.split("\n").filter(line => !line.startsWith("lavfi.freezedetect.") || line.includes("=")).join("\n").split("frame:").slice(1).map(record => record.trim().split(/\s+/u));
  assert.deepEqual(records, [
    ["5", "pts:5", "pts_time:1.25", "lavfi.freezedetect.freeze_start=0.75"],
    ["6", "pts:6", "pts_time:1.5", "lavfi.freezedetect.freeze_duration=0.75", "lavfi.freezedetect.freeze_end=1.5"]
  ]);
});

for (const level of ["info", "error"]) {
  it(`selects the freeze end frame from its metadata at log level ${level}`, async () => {
    const { result, output, error } = await run("freezedetect=n=0:d=0.5,metadata=select:key=lavfi.freezedetect.freeze_end", samples, level);
    assert.equal(result.exitCode, 0, error);
    assert.equal(output.length, 12);
    assert.equal(createHash("sha256").update(output).digest("hex"), "a6e7cf02ce7907874c77fa816dd30b13cb4c30da2d82f99e0421773968777dbe");
    if (level === "error") assert.equal(error, "");
  });
}

for (const [filter, expected] of [["null", samples.flat()], ["select='eq(n,6)'", samples[6]!]] as const) {
  it(`preserves the passing control ${filter}`, async () => {
    const { result, output, error } = await run(filter);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(output, Buffer.from(expected));
  });
}

for (const options of ["n=0:d=0.5", "noise=0:duration=500ms", "0:0.5", "n=-60dB:d=0.5"]) {
  it(`keeps a freeze open at EOF (${options})`, async () => {
    const { result, error } = await run(`freezedetect=${options},metadata=print`, samples.slice(0, 6));
    assert.equal(result.exitCode, 0, error);
    assert.ok(error.includes("lavfi.freezedetect.freeze_start=0.75\n"), error);
    assert.ok(!error.includes("freeze_end"), error);
  });
}

it("uses the first frozen frame as the noise reference, including chroma", async () => {
  const frames = [0, 2, 4, 6].map(delta => [...Array<number>(4).fill(16), ...Array<number>(8).fill(128 + delta)]);
  const { result, error } = await run("freezedetect=n=0.006:d=0.5,metadata=print", frames);
  assert.equal(result.exitCode, 0, error);
  assert.ok(error.includes("lavfi.freezedetect.freeze_start=0\n"), error);
  assert.ok(error.includes("lavfi.freezedetect.freeze_end=0.5\n"), error);
  assert.ok(error.includes("lavfi.freezedetect.freeze_duration=0.5\n"), error);
});

for (const options of ["n=-1", "n=2", "n=NaN", "d=-1", "d=oops", "unknown=1"]) {
  it(`rejects invalid options without replacing output (${options})`, async () => {
    const { result, output } = await run(`freezedetect=${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "KEEP");
  });
}

it("defaults to two seconds and reports separate freeze intervals", async () => {
  const frames = [...Array<number[]>(9).fill(samples[0]!), samples[3]!,
    ...Array<number[]>(8).fill(samples[3]!), samples[6]!];
  const { result, error } = await run("freezedetect,metadata=print", frames);
  assert.equal(result.exitCode, 0, error);
  for (const value of ["freeze_start=0", "freeze_duration=2.25", "freeze_end=2.25", "freeze_start=2.25", "freeze_end=4.5"]) {
    assert.ok(error.includes(`lavfi.freezedetect.${value}\n`), error);
  }
});

it("does not report intervals below the minimum duration", async () => {
  const { result, error, output } = await run("freezedetect=n=0:d=1,metadata=print");
  assert.equal(result.exitCode, 0, error);
  assert.equal(error, "");
  assert.deepEqual(output, Buffer.from(samples.flat()));
});

it("uses upstream timestamps for freeze metadata", async () => {
  const { result, error } = await run("setpts=PTS+4,freezedetect=n=0:d=0.5,metadata=print");
  assert.equal(result.exitCode, 0, error);
  assert.ok(error.includes("lavfi.freezedetect.freeze_start=1.75\n"), error);
  assert.ok(error.includes("lavfi.freezedetect.freeze_end=2.5\n"), error);
});

it("treats the noise threshold as inclusive and normalizes by 256", async () => {
  const frames = [0, 1, 1, 100].map(delta => Array<number>(12).fill(16 + delta));
  const { result, error } = await run("freezedetect=n=1/256:d=0.5,metadata=print", frames);
  assert.equal(result.exitCode, 0, error);
  assert.ok(error.includes("lavfi.freezedetect.freeze_start=0\n"), error);
  assert.ok(error.includes("lavfi.freezedetect.freeze_end=0.75\n"), error);
});

for (const [format, depth] of [[68, 10], [49, 16]] as const) {
  it(`compares native ${depth}-bit samples without losing low bits`, async () => {
    const frames = [0, 0, 0, 1].map((delta, index) => {
      const data = new Uint8Array(16);
      const pixels = new Uint8Array(24);
      const view = new DataView(pixels.buffer);
      for (let i = 0; i < 12; i++) view.setUint16(i * 2, 128 + delta, true);
      return { width: 2, height: 2, data, ptsSeconds: index / 4, durationSeconds: 0.25, keyframe: true,
        native: { rgba: data, pixels, width: 2, height: 2, format, colorspace: 5, fullRange: 0 } };
    });
    let report = "";
    const output = [];
    for await (const frame of freezedetect(frames, "n=0:d=0.5", undefined, new MediaBudgetTracker(), {
      logLevel: 32, async write(text) { report += text; }
    })) output.push(frame);
    assert.equal(report, "lavfi.freezedetect.freeze_start: 0\nlavfi.freezedetect.freeze_duration: 0.75\nlavfi.freezedetect.freeze_end: 0.75\n");
    for (const [index, frame] of output.entries()) {
      assert.equal(frame.data, frames[index]!.data);
      assert.equal(frame.native, frames[index]!.native);
    }
  });
}
