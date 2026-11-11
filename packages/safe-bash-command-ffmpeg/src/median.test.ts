import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { median } from "./median.js";
import { createFfmpegCommand } from "./index.js";

const impulse = Buffer.from(Array.from({ length: 1024 }, (_, i) => i === 0 || i === 528 ? 245 : 20));

async function run(filter: string, input = impulse, format = "gray", size = "32x32") {
  const volume = Volume.fromJSON({ "/in": input, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-framerate", "4", "-i", "/in", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}

it("preserves the raw grayscale control", async () => {
  const result = await run("null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, impulse);
});

const gray16 = Buffer.alloc(8 * 6 * 2);
for (let y = 0; y < 6; y++) {
  for (let x = 0; x < 8; x++) {
    const value = x === 0 && y === 0 ? 245 : x === 3 && y === 2 ? 4 : (x * 37 + y * 29 + x * y * 3) % 251;
    gray16.writeUInt16LE(value * 251 + 7, (y * 8 + x) * 2);
  }
}

// Complete native FFmpeg 7.0.2 outputs, including borders and low sample bits.
for (const format of ["gray16le", "gray16be"]) {
  for (const [filter, hash] of [
    ["null", "87bc405060eeb7bbb7af1d4d9827062b50a827ebeba8a0a9db272f419ee74648"],
    ["median", "0cfc76a7865a68f34d2053f7d0372df7ac12c2884d114a5fbad0b451952dfdd5"],
    ["median=radius=2:radiusV=1:percentile=0.9", "442ff051bf8f49adb02d5abfd0e355705acb8ef2c73a02703b8bd89415c96637"]
  ]) {
    it(`matches native ${filter} with full ${format} precision`, async () => {
      const input = Buffer.from(gray16);
      if (format === "gray16be") input.swap16();
      const result = await run(filter!, input, format, "8x6");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, 96);
      if (format === "gray16be") result.output.swap16();
      assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    });
  }
  it(`preserves disabled ${format} samples`, async () => {
    for (const filter of ["median=planes=0", "median=enable=0"]) {
      const result = await run(filter, gray16, format, "8x6");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, gray16);
    }
  });
}

// Native FFmpeg 7.0.2 references include corner and center impulses.
for (const [filter, hash] of [
  ["median=radius=2", "7142d4166632b2d118bca6301456178185c234d7e1e1a302b38165521bcbff4d"],
  ["median=radius=2:percentile=1", "e40920b2df21e9f7c8b97c6d6ee16a250cdbb95347ba739cf1361721849112cd"]
]) {
  it(`matches native ${filter} on isolated bright pixels`, async () => {
    const result = await run(filter!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 1024);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

const ramp = Buffer.from(Array.from({ length: 63 }, (_, i) => ((i % 9) * 37 + Math.floor(i / 9) * 61) % 256));
// Native references exercise rank rounding, rectangular windows and clamped borders.
for (const [filter, hash] of [
  ["median", "2f406f121367cafd2f8858009f348a947f1bd387969c55fec1e75bc20436ee5a"],
  ["median=2:15:1:0.25", "aa7aae8ecf590186cee0c086238c59c87199587d1a475312fed58b88911f297c"],
  ["median=2:15:1:0", "8d17e0148e460fa0ebb917b638dc99617c370ff35c0aca173344a89797df1354"],
  ["median=2:15:1:1", "5024355ef392d2e4647c3c2eedc614944784f0c1719a7e41e2dc46a355a8be45"],
  ["median=127:15:127:0.75", "cd287a05ab90534e6afe4f9f1533e30be6d399f177349192c0c466a265173ca5"],
  ["median=2:15:1:0.1", "416b13caeb4af47847a5d97041a39c42a2f968550a783cd8679d4bf5970a102e"],
  ["median=2:15:1:0.9", "aa21ca6259ffe98249b75b95554cd3094121766fcb266cbd6b0d6c4cc397b709"]
]) {
  it(`matches native ${filter} on varied grayscale samples`, async () => {
    const result = await run(filter!, ramp, "gray", "9x7");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

// Native FFmpeg references cover every pixel, including repeated edge samples.
const defaultFixture = Buffer.from(Array.from({ length: 48 }, (_, i) => {
  const x = i % 8;
  const y = Math.floor(i / 8);
  return x === 0 && y === 0 ? 245 : x === 3 && y === 2 ? 4 : (x * 37 + y * 29 + x * y * 3) % 251;
}));
for (const options of [
  "", "planes=0:planes=default", "radius=2:radius=default",
  "percentile=0:percentile=default", "radiusV=2:radiusV=default",
  "2:0:2:0:radius=default:planes=default:radiusV=default:percentile=default",
  "radius=2:radius=default+1:radius=default"
]) {
  it(`restores declared median defaults after ${options || "no options"}`, async () => {
    const result = await run(options ? `median=${options}` : "median", defaultFixture, "gray", "8x6");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 48);
    assert.equal(createHash("sha256").update(result.output).digest("hex"),
      "7209ba8789b5b7c6a1326c193341e8c77c40e493badf1eba6e41aa38741e3b99");
  });
}

for (const options of [
  "threads=1", "thread_type=slice", "extra_hw_frames=1",
  "threads=0:thread_type=none:extra_hw_frames=-1",
  "threads=max:thread_type=+slice:extra_hw_frames=max",
  "threads=default:thread_type=all-slice:extra_hw_frames=default",
  "1:15:0:0.5:threads=1:thread_type=slice:extra_hw_frames=1"
]) {
  it(`accepts median scheduling options ${options} without changing pixels`, async () => {
    const result = await run(`median=${options}`, defaultFixture, "gray", "8x6");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 48);
    assert.equal(createHash("sha256").update(result.output).digest("hex"),
      "7209ba8789b5b7c6a1326c193341e8c77c40e493badf1eba6e41aa38741e3b99");
  });
}

it("accepts named instances, expressions and the default vertical radius", async () => {
  const expected = await run("median=2:15:2:0.5");
  for (const filter of ["median@noise=radius=1+1", "median=radius=2:radiusV=0"]) {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, expected.output);
  }
});

it("preserves disabled frames and unselected grayscale planes", async () => {
  for (const filter of ["median=planes=0", "median=planes=2", "median=enable=0"]) {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, impulse);
  }
});

it("evaluates timeline enable independently for each frame", async () => {
  const result = await run("median=radius=2:enable=gte(n\\,1)", Buffer.concat([impulse, impulse]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([impulse, Buffer.alloc(1024, 20)]));
});

it("clips the window to a single-pixel input", async () => {
  const result = await run("median=radius=127:percentile=1", Buffer.from([123]), "gray", "1x1");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.from([123]));
});

for (const option of ["radius=0", "radius=128", "radiusV=-1", "radiusV=128", "percentile=-0.1", "percentile=1.1",
  "threads=-1", "threads=2147483648", "threads=nan", "threads=no",
  "thread_type=frame", "thread_type=0.5", "thread_type=4294967296",
  "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=nan",
  "threads=-1:threads=1",
  "percentile=nan", "radius=no", "planes=16", "unknown=1", "1:15:0:0.5:1"]) {
  it(`rejects ${option} before replacing output`, async () => {
    const result = await run(`median=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /median/);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("preserves frame metadata and input samples while honoring budgets and cancellation", async () => {
  const data = new Uint8Array(32 * 32 * 4).fill(20);
  const frame = { data, width: 32, height: 32, ptsSeconds: 1.25, durationSeconds: 0.25, keyframe: true, offset: 1024 };
  const [filtered] = await median([frame], "radius=2", "gray", new MediaBudgetTracker());
  assert.equal(filtered!.ptsSeconds, frame.ptsSeconds);
  assert.equal(filtered!.durationSeconds, frame.durationSeconds);
  assert.equal(filtered!.offset, frame.offset);
  assert.deepEqual(data, new Uint8Array(data.length).fill(20));
  await assert.rejects(median([frame], "", "gray", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(median([frame], "", "gray", new MediaBudgetTracker({ maxCpuMs: -1 })), /maxCpuMs/);
  const controller = new AbortController();
  const pending = median([frame], "radius=2", "gray", new MediaBudgetTracker(), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

it("rejects unsupported color input before replacing output", async () => {
  const result = await run("median", Buffer.alloc(32 * 32 * 3, 20), "rgb24");
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /median: only 8-bit or 16-bit grayscale/);
  assert.equal(result.output.toString(), "KEEP");
});
