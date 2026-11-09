import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const channels = [1, -1].map(sign => Float64Array.from({ length: 4096 }, (_, i) => sign * (i + 1) / 32768));
const wav = encodeWav({ sampleRate: 8000, channels });
const pcm = Buffer.alloc(4096 * 4);
for (let i = 0; i < 4096; i++) {
  pcm.writeInt16LE(i + 1, i * 4);
  pcm.writeInt16LE(-i - 1, i * 4 + 2);
}

async function run(input: string, seek = false, limits = {}) {
  const volume = Volume.fromJSON({ "/clips/out.pcm": "KEEP" });
  for (const [name, bytes] of Object.entries({
    "whole.wav": wav, "a.part": wav.subarray(0, 19), " b.part ": wav.subarray(19, 8013), "c.part": wav.subarray(8013)
  })) volume.writeFileSync(`/clips/${name}`, bytes);
  const args = ["-v", "error", "-y", ...(seek ? ["-ss", "0.248"] : []), "-i", input,
    ...(seek ? ["-t", "0.005"] : []), "-c:a", "pcm_s16le", "-f", "s16le", "out.pcm"];
  let stderr = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args, cwd: "/clips", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    },
    stdin: (async function* () {})(),
    stdout: { async write() { assert.fail("unexpected stdout"); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/clips/out.pcm") as Buffer };
}

for (const input of ["whole.wav", "concat:a.part| b.part |file:/clips/c.part", "concat:whole.wav|whole.wav"]) {
  for (const seek of [false, true]) {
    it(`reads ${input} as one byte stream with seek ${seek}`, async () => {
      const result = await run(input, seek);
      assert.equal(result.exitCode, 0, result.stderr);
      // FFmpeg 7.0.2: 4096 frames, or frames [1985,-1985] through [2024,-2024].
      assert.deepEqual(result.output, seek ? pcm.subarray(1984 * 4, 2024 * 4) : pcm);
    });
  }
}

for (const limits of [{ maxInputBytes: wav.length - 1 }, { maxConcatInputs: 2 }, { maxMemoryBytes: wav.length - 1 }]) {
  it(`rejects concat input before replacing output under ${JSON.stringify(limits)}`, async () => {
    const result = await run("concat:a.part| b.part |c.part", false, limits);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(Object.keys(limits)[0]!), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("rejects a missing part without replacing output", async () => {
  const result = await run("concat:whole.wav|missing");
  assert.equal(result.exitCode, 1);
  assert.equal(result.output.toString(), "KEEP");
});

it("declines synchronous concat evaluation before reading a literal protocol filename", () => {
  const reads: string[] = [];
  assert.equal(evalSyncFfmpeg(["-y", "-i", "concat:a|b", "-f", "s16le", "out.pcm"], undefined,
    path => { reads.push(path); return wav; }, () => assert.fail("unexpected write")), undefined);
  assert.deepEqual(reads, []);
});
