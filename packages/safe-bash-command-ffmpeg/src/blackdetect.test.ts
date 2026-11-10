import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const luma = [[16,16,16,16], [16,16,16,32], [16,16,16,16],
  [200,200,200,200], [200,200,200,200], [200,200,200,200], [80,80,80,80], [16,16,16,16]];
const raw = Buffer.from(luma.flatMap(frame => [...frame, ...Array<number>(8).fill(128)]));

async function run(filter: string, level = "info", frames = luma, range = "") {
  const volume = Volume.fromJSON({ "/o.raw": "KEEP", "/stats.log": "KEEP" });
  volume.writeFileSync("/in.y4m", Buffer.concat([
    Buffer.from(`YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444${range}\n`),
    ...frames.map(frame => Buffer.concat([Buffer.from("FRAME\n"), Buffer.from([...frame, ...Array<number>(8).fill(128)])]))
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
    }, stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString(), output: volume.readFileSync("/o.raw") as Buffer };
}

it("reports native black intervals and boundary tags without changing video bytes", async () => {
  const { result, volume, error, output } = await run("blackdetect=d=0.5:pix_th=0.1,metadata=print");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, raw);
  assert.equal(createHash("sha256").update(output).digest("hex"), "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
  assert.ok(error.includes("black_start:0 black_end:0.75 black_duration:0.75\n"), error);
  assert.deepEqual(error.split("\n").filter(line => line.startsWith("lavfi.")),
    ["lavfi.black_start=0", "lavfi.black_end=0.75", "lavfi.black_start=1.75"]);
  for (const header of ["frame:0    pts:0       pts_time:0", "frame:3    pts:3       pts_time:0.75", "frame:7    pts:7       pts_time:1.75"]) {
    assert.ok(error.includes(header), error);
  }
  assert.ok(!error.includes("black_start:1.75"), error);
  assert.equal(volume.readFileSync("/stats.log", "utf8"), "KEEP");
});

it("selects only the first non-black frame carrying black_end", async () => {
  const { result, error, output } = await run("blackdetect=d=0.5:pix_th=0.1,metadata=select:key=lavfi.black_end");
  assert.equal(result.exitCode, 0, error);
  assert.equal(output.length, 12);
  assert.equal(createHash("sha256").update(output).digest("hex"), "45874da89521bb74a21e4818cad2bcdf8bf9407acb7f67541f0a05b815c758e1");
  assert.ok(error.includes("black_start:0 black_end:0.75 black_duration:0.75\n"), error);
});

it("keeps boundary tags below the default two-second logging minimum", async () => {
  const { result, error, output } = await run("blackdetect,metadata=mode=select:key=lavfi.black_start");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat([raw.subarray(0, 12), raw.subarray(84)]));
  assert.ok(!error.includes("black_duration:"), error);
});

it("selects metadata even when informational logging is disabled", async () => {
  const { result, error, output } = await run("blackdetect=d=0,metadata=select:key=lavfi.black_end", "error");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, raw.subarray(36, 48));
  assert.equal(error, "");
});

it("uses inclusive pixel and picture thresholds with long option names", async () => {
  const { result, error, output } = await run("blackdetect=black_min_duration=0:picture_black_ratio_th=0.75:pixel_black_th=0,metadata=print");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, raw);
  assert.ok(error.includes("black_start:0 black_end:0.75 black_duration:0.75\n"), error);
  assert.ok(error.includes("black_start:1.75 black_end:1.75 black_duration:0\n"), error);
  assert.ok(!error.includes("lavfi.black_end=1.75"), error);
});

it("supports positional thresholds and truncates the duration to input timebase ticks", async () => {
  const { result, error } = await run("blackdetect=0.99:0.98:0.1");
  assert.equal(result.exitCode, 0, error);
  assert.ok(error.includes("black_start:0 black_end:0.75 black_duration:0.75\n"), error);
});

it("distinguishes full-range and limited-range pixel thresholds", async () => {
  const frames = [[30,30,30,30], [200,200,200,200]];
  for (const [range, expected] of [["", 12], [" XCOLORRANGE=FULL", 0]] as const) {
    const { result, error, output } = await run("blackdetect=d=0,metadata=select:key=lavfi.black_end", "error", frames, range);
    assert.equal(result.exitCode, 0, error);
    assert.equal(output.length, expected);
  }
});

it("uses the truncated inclusive limited-range luma threshold", async () => {
  const { result, error } = await run("blackdetect=d=0,metadata=print", "info", [[37,37,37,37], [38,38,38,38]]);
  assert.equal(result.exitCode, 0, error);
  assert.ok(error.includes("black_start:0 black_end:0.25 black_duration:0.25\n"), error);
});

it("retains upstream metadata and uses timestamps after setpts", async () => {
  const { result, error } = await run("setpts=PTS+4,signalstats,blackdetect=d=0.5,metadata=print");
  assert.equal(result.exitCode, 0, error);
  assert.ok(error.includes("black_start:1 black_end:1.75 black_duration:0.75\n"), error);
  assert.ok(error.includes("lavfi.signalstats.YMIN=16\n"), error);
  assert.ok(error.includes("lavfi.black_start=1\n"), error);
  assert.ok(error.includes("lavfi.black_end=1.75\n"), error);
});

for (const filter of ["blackdetect=d=-1", "blackdetect=pic_th=1.1", "blackdetect=pix_th=-0.1", "blackdetect=unknown=1", "blackdetect=d=NaN", "metadata=select"]) {
  it(`rejects ${filter} before replacing the output`, async () => {
    const { result, output } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "KEEP");
  });
}

for (const [filter, expected] of [["null", raw], ["select='eq(n,3)'", raw.subarray(36, 48)]] as const) {
  it(`preserves the ${filter} control`, async () => {
    const { result, error, output } = await run(filter);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(output, expected);
  });
}
