import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const wav = encodeWav({ sampleRate: 8000,
  channels: [1, -1].map(sign => Float64Array.from({ length: 4096 }, (_, i) => sign * (i + 1) / 32768)) });

async function run(input: string, extra: string[] = [], limits = {}) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/clips");
  for (const [name, bytes] of Object.entries({
    "whole.wav": wav, "a.part": wav.subarray(0, 19), " b.part ": wav.subarray(19, 8013), "c.part": wav.subarray(8013)
  })) await fs.writeFile(`/clips/${name}`, bytes);
  let output = "", diagnostic = "";
  const args = ["-v", "error", "-show_entries", "stream=codec_name,channels,sample_rate,duration", "-of", "json", ...extra, input];
  const result = await createFfprobeCommand({ limits }).execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/clips", env: {}, fs,
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  return { ...result, output, diagnostic };
}

for (const input of ["whole.wav", "concat:a.part| b.part |file:/clips/c.part", "concat:whole.wav|whole.wav"]) {
  for (const extra of [[], ["-f", "wav"], ["-show_packets", "-show_data_hash", "sha256"]]) {
    it(`probes ${input} with ${extra.join(" ")}`, async () => {
      const result = await run(input, extra);
      expect(result.exitCode, result.diagnostic).toBe(0);
      expect(JSON.parse(result.output).streams).toEqual([
        { codec_name: "pcm_s16le", channels: 2, sample_rate: "8000", duration: "0.512000" }
      ]);
      if (extra.includes("-show_packets")) {
        const whole = await run("whole.wav", extra);
        expect(JSON.parse(result.output).packets).toEqual(JSON.parse(whole.output).packets);
      }
    });
  }
}

for (const limits of [{ maxInputBytes: wav.length - 1 }, { maxConcatInputs: 2 }, { maxMemoryBytes: wav.length - 1 }]) {
  it(`rejects concat input without publishing output under ${JSON.stringify(limits)}`, async () => {
    const result = await run("concat:a.part| b.part |c.part", [], limits);
    expect(result.exitCode).toBe(1);
    expect(result.diagnostic).toContain("maxInputBytes" in limits ? "EFBIG" : Object.keys(limits)[0]);
    expect(result.output).toBe("");
  });
}

it("rejects a missing part without publishing output", async () => {
  const result = await run("concat:whole.wav|missing");
  expect(result.exitCode).toBe(1);
  expect(result.output).toBe("");
});

it("declines synchronous concat evaluation before looking up a literal protocol filename", () => {
  const reads: string[] = [];
  expect(evalSyncFfprobe(undefined, ["-of", "json", "concat:a|b"], path => { reads.push(path); return wav; })).toBeUndefined();
  expect(reads).toEqual([]);
});
