import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function run(flags: string[], output = ["-f", "null", "-"]) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/i.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 4096 }, (_, i) => (i - 2048) / 32768)] }));
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

for (const flags of [[], ["-nostats"]]) {
  it(`reports native completion records with ${flags.join(" ") || "default stats"}`, async () => {
    const result = await run(["-progress", "pipe:1", ...flags]);
    assert.equal(result.exitCode, 0, result.stderr);
    const records = Object.fromEntries(result.stdout.trim().split("\n").map(line => line.split("=")));
    assert.equal(records.out_time, "00:00:00.512000");
    assert.equal(records.out_time_us, "512000");
    assert.equal(records.out_time_ms, "512000");
    assert.equal(records.progress, "end");
    assert.equal(records.total_size, "N/A");
    assert.equal(records.bitrate, "N/A");
    assert.equal(records.dup_frames, "0");
    assert.equal(records.drop_frames, "0");
    assert.equal(result.stderr, "");
    assert.deepEqual(result.volume.readdirSync("/"), ["i.wav"]);
  });
}

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

it("rejects unsupported progress destinations without creating a file", async () => {
  const result = await run(["-progress", "/progress.txt"]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("stdout only"), result.stderr);
  assert.deepEqual(result.volume.readdirSync("/"), ["i.wav"]);
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
