import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = Buffer.from(Array.from({ length: 16 }, (_, i) => i));

async function run(flags: string[], beforeInput = false, existingOutput = false) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  if (existingOutput) volume.writeFileSync("/out.bin", "keep");
  let stdout = "";
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-progress", "pipe:1",
      ...(beforeInput ? flags : []), "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(beforeInput ? [] : flags), "-f", "s16le", "/out.bin"],
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

// FFmpeg 7.0.2: all positive intervals preserve these 16 bytes and end at 1000 us.
for (const period of [undefined, "0.1", "100ms", "00:00:00.1", "1us"]) {
  for (const beforeInput of [false, true]) {
    it(`accepts stats_period=${period ?? "omitted"} ${beforeInput ? "before input" : "before output"}`, async () => {
      const result = await run(period === undefined ? [] : ["-stats_period", period], beforeInput);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.volume.readFileSync("/out.bin"), input);
      const records = Object.fromEntries(result.stdout.trim().split("\n").map(line => line.split("=")));
      assert.equal(records.out_time_us, "1000");
      assert.equal(records.progress, "end");
    });
  }
}

for (const period of ["0", "-0.1", "0.0000001"]) {
  for (const existingOutput of [false, true]) {
    it(`rejects nonpositive stats_period=${period} with ${existingOutput ? "existing" : "absent"} output`, async () => {
      const result = await run(["-stats_period", period], false, existingOutput);
      assert.equal(result.exitCode, 234, result.stderr);
      assert.ok(result.stderr.includes("must be positive"), result.stderr);
      assert.equal(result.stdout, "");
      if (existingOutput) assert.equal(result.volume.readFileSync("/out.bin", "utf8"), "keep");
      else assert.equal(result.volume.existsSync("/out.bin"), false);
    });
  }
}

for (const period of ["invalid", "NaN", "Infinity"]) {
  it(`rejects invalid stats_period=${period}`, async () => {
    const result = await run(["-stats_period", period]);
    assert.equal(result.exitCode, 234, result.stderr);
    assert.ok(result.stderr.includes("Invalid duration"), result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.volume.existsSync("/out.bin"), false);
  });
}

it("accepts stats_period in synchronous execution without progress", () => {
  const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] });
  assert.equal(evalSyncFfmpeg(["-stats_period", "0.1", "-i", "/in.wav", "-f", "null", "-"], undefined,
    () => wav), "");
  for (const period of ["0", "-0.1", "invalid"]) {
    assert.equal(evalSyncFfmpeg(["-stats_period", period, "-i", "/in.wav", "-f", "null", "-"], undefined,
      () => wav), undefined);
  }
});
