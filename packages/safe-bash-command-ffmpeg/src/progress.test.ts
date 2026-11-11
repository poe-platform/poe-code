import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function run(flags: string[], output = ["-f", "null", "-"], video: boolean | "raw" = false) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/i.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 4096 }, (_, i) => (i - 2048) / 32768)] }));
  if (video === true) volume.writeFileSync("/i.wav", Buffer.concat([
    Buffer.from("YUV4MPEG2 W2 H2 F2:1 Ip A1:1 C420jpeg\n"),
    ...Array.from({ length: 2 }, () => Buffer.concat([Buffer.from("FRAME\n"), Buffer.alloc(6, 128)]))
  ]));
  if (video === "raw") volume.writeFileSync("/i.wav", Uint8Array.from({ length: 16 }, (_, i) => i));
  let stdout = "";
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...flags, "-i", "/i.wav", ...output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stdout, stderr, volume };
}

for (const video of [false, true]) {
  it(`keeps progress timestamps unavailable for empty ${video ? "video" : "audio"} output`, async () => {
    const result = await run(["-progress", "pipe:1"], ["-t", "0", "-f", "null", "-"], video);
    assert.equal(result.exitCode, 0, result.stderr);
    const records = Object.fromEntries(result.stdout.trim().split("\n").map(line => line.split("=")));
    assert.equal(records.out_time_us, "N/A");
    assert.equal(records.out_time_ms, "N/A");
    assert.equal(records.out_time, "N/A");
    assert.equal(records.progress, "end");
    assert.equal(result.stderr, "");
  });
}

it("preserves a measured zero timestamp when video frames were produced", async () => {
  const result = await run(["-progress", "pipe:1"],
    ["-frames:v", "1", "-output_ts_offset", "-0.5", "-f", "null", "-"], true);
  assert.equal(result.exitCode, 0, result.stderr);
  const records = Object.fromEntries(result.stdout.trim().split("\n").map(line => line.split("=")));
  assert.equal(records.out_time_us, "0");
  assert.equal(records.out_time_ms, "0");
  assert.equal(records.out_time, "00:00:00.000000");
  assert.equal(records.frame, "1");
  assert.equal(records.progress, "end");
});

for (const flags of [[], ["-nostats"]]) {
  it(`reports native completion records with ${flags.join(" ") || "default stats"}`, async () => {
    const result = await run(["-progress", "pipe:1", ...flags]);
    assert.equal(result.exitCode, 0, result.stderr);
    const records = Object.fromEntries(result.stdout.trim().split("\n").map(line => line.split("=")));
    assert.equal(records.out_time, "00:00:00.512000");
    assert.equal(records.out_time_us, "512000");
    assert.equal(records.out_time_ms, "512000");
    assert.equal(records.progress, "end");
    assert.ok(records.speed?.endsWith("x"), records.speed);
    assert.ok(Number.isFinite(Number(records.speed.slice(0, -1))) && Number(records.speed.slice(0, -1)) > 0);
    assert.equal(records.frame, undefined);
    assert.equal(records.fps, undefined);
    assert.equal(records.stream_0_0_q, undefined);
    assert.equal(records.total_size, "N/A");
    assert.equal(records.bitrate, "N/A");
    assert.equal(records.dup_frames, "0");
    assert.equal(records.drop_frames, "0");
    assert.equal(result.stderr, "");
    assert.deepEqual(result.volume.readdirSync("/"), ["i.wav"]);
  });
}

it("keeps speed unavailable for zero processed duration", async () => {
  const result = await run(["-progress", "pipe:1"], ["-t", "0", "-f", "null", "-"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("speed=N/A\n"), result.stdout);
});

it("keeps speed unavailable when no time has elapsed", async (t) => {
  t.mock.method(performance, "now", () => 0);
  const result = await run(["-progress", "pipe:1"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("speed=N/A\n"), result.stdout);
});

it("accepts nostats without requesting progress", async () => {
  const result = await run(["-nostats"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(evalSyncFfmpeg(["-nostats", "-i", "/i.wav", "-f", "null", "-"], undefined,
    path => result.volume.readFileSync(path) as Buffer), "");
});

it("reports the processed duration after trimming and only one completion for multiple outputs", async () => {
  const result = await run(["-progress", "pipe:1"], ["-t", "0.1", "-f", "null", "-", "-t", "0.2", "-f", "null", "-"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("out_time=00:00:00.200000\n"), result.stdout);
  assert.equal(result.stdout.split("progress=end").length, 2);
});

it("does not report completion when output processing fails", async () => {
  const result = await run(["-progress", "pipe:1"], ["-f", "not_a_muxer", "-"]);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, "");
});

it("rejects a missing progress destination", async () => {
  const result = await run([], ["-f", "null", "-", "-progress"]);
  assert.equal(result.exitCode, 234);
  assert.ok(result.stderr.includes("Missing argument"), result.stderr);
});

for (const target of ["pipe:2", "report.txt", "/report.txt"]) {
  it(`writes completion records only to ${target}`, async () => {
    const result = await run(["-progress", target]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    const progress = target === "pipe:2" ? result.stderr : result.volume.readFileSync("/report.txt", "utf8");
    assert.ok(progress.includes("out_time_us=512000\n"), String(progress));
    assert.ok(progress.includes("progress=end\n"), String(progress));
    if (target !== "pipe:2") assert.equal(result.stderr, "");
    else assert.deepEqual(result.volume.readdirSync("/"), ["i.wav"]);
  });
}

it("reports progress destination write failures", async () => {
  const result = await run(["-progress", "/missing/report.txt"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("ENOENT"), result.stderr);
});

for (const format of ["s16le", "wav"]) {
  it(`reports actual ${format} output bytes and bitrate`, async () => {
    const result = await run(["-progress", "pipe:1"], ["-f", format, "/o.bin"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const records = Object.fromEntries(result.stdout.trim().split("\n").map(line => line.split("=")));
    const size = result.volume.statSync("/o.bin").size;
    if (format === "s16le") assert.equal(size, 8192);
    else assert.ok(size > 8192);
    assert.equal(records.total_size, String(size));
    assert.ok(records.speed?.endsWith("x"), records.speed);
    assert.ok(Number.isFinite(Number(records.speed.slice(0, -1))) && Number(records.speed.slice(0, -1)) > 0);
    assert.equal(records.bitrate?.trim(), `${(size * 8 / 512).toFixed(1)}kbits/s`);
    assert.equal(records.out_time_us, "512000");
    assert.equal(records.progress, "end");
    assert.equal(result.stderr, "");
  });
}

it("reports the first output size and uses the processed duration for bitrate", async () => {
  const result = await run(["-progress", "pipe:1"],
    ["-t", "0.1", "-f", "s16le", "/first.raw", "-t", "0.2", "-f", "s16le", "/second.raw"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("total_size=1600\n"), result.stdout);
  assert.ok(result.stdout.includes("bitrate=64.0kbits/s\n"), result.stdout);
});

it("keeps size and bitrate unavailable when the first output uses the null muxer", async () => {
  const result = await run(["-progress", "pipe:1"], ["-f", "null", "-", "-f", "s16le", "/o.raw"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("total_size=N/A\n"), result.stdout);
  assert.ok(result.stdout.includes("bitrate=N/A\n"), result.stdout);
});

for (const [flags, frames, duration] of [[[], "2", "1000000"], [["-frames:v", "1"], "1", "500000"]] as const) {
  it(`reports processed video statistics for ${frames} frames`, async () => {
    const result = await run(["-progress", "pipe:1"], [...flags, "-f", "null", "-"], true);
    assert.equal(result.exitCode, 0, result.stderr);
    const records = Object.fromEntries(result.stdout.trim().split("\n").map(line => line.split("=")));
    assert.equal(records.frame, frames);
    assert.ok(records.speed?.endsWith("x"), records.speed);
    assert.ok(Number.isFinite(Number(records.speed.slice(0, -1))) && Number(records.speed.slice(0, -1)) > 0);
    assert.ok(Number.isFinite(Number(records.fps)) && Number(records.fps) >= 0);
    assert.equal(records.stream_0_0_q, "-0.0");
    assert.equal(records.out_time_us, duration);
    assert.equal(records.progress, "end");
    assert.equal(result.stderr, "");
  });
}

it("reports quality for each video output while counting the first video stream", async () => {
  const result = await run(["-progress", "pipe:1"], ["-frames:v", "1", "-f", "null", "-", "-f", "null", "-"], true);
  assert.equal(result.exitCode, 0, result.stderr);
  const records = Object.fromEntries(result.stdout.trim().split("\n").map(line => line.split("=")));
  assert.equal(records.frame, "1");
  assert.equal(records.stream_0_0_q, "-0.0");
  assert.equal(records.stream_1_0_q, "-0.0");
});

for (const format of ["rawvideo", "null"]) {
  for (const [flags, duplicates] of [[["-r", "8"], "4"], [["-vf", "fps=8"], "0"], [["-vf", "fps=8", "-r", "8"], "0"], [["-vf", "fps=8", "-r", "16"], "8"]] as const) {
    it(`counts only ${format} output synchronization duplicates for ${flags.join(" ")}`, async () => {
      const result = await run(["-progress", "pipe:1", "-f", "rawvideo", "-framerate", "4",
        "-pixel_format", "gray", "-video_size", "2x2"], [...flags, "-f", format, "/out.bin"], "raw");
      assert.equal(result.exitCode, 0, result.stderr);
      const records = Object.fromEntries(result.stdout.trim().split("\n").map(line => line.split("=")));
      const copies = flags.some(flag => flag === "16") ? 4 : 2;
      const expected = Buffer.concat(Array.from({ length: 4 }, (_, frame) =>
        Buffer.concat(Array.from({ length: copies }, () => Buffer.from([0, 1, 2, 3].map(pixel => frame * 4 + pixel))))));
      if (format === "rawvideo") assert.deepEqual(result.volume.readFileSync("/out.bin"), expected);
      assert.equal(records.frame, String(4 * copies));
      assert.equal(records.dup_frames, duplicates);
      assert.equal(records.progress, "end");
    });
  }
}
