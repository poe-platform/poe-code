import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createFfprobeCommand, createInputReader, evalSyncFfprobe } from "./media.js";

const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(64), new Float64Array(64)] });
const input = `data:audio/wav;base64,${Buffer.from(wav).toString("base64")}`;

function context(args: string[] = []) {
  const fs = new MemoryFileSystem();
  let output = "", diagnostic = "";
  const command: CommandContext = {
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  };
  return { command, output: () => output, diagnostic: () => diagnostic };
}

for (const extra of [[], ["-f", "wav"], ["-show_packets"]]) {
  it(`probes inline bytes on a retained filesystem with ${extra.join(" ")}`, async () => {
    const run = context(["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,duration_ts:format=size", "-of", "json", ...extra, input]);
    const result = await createFfprobeCommand().execute(run.command);
    expect(result.exitCode, run.diagnostic()).toBe(0);
    const output = JSON.parse(run.output());
    expect(output.streams).toEqual([{ codec_name: "pcm_s16le", sample_rate: "8000", channels: 2 }]);
    expect(output.format).toEqual({});
    if (extra.includes("-show_packets")) expect(output.packets).toHaveLength(1);
  });
}

for (const length of [12287, 12288, 12289, 24578]) {
  it(`reads ${length} inline bytes across base64 chunk and padding boundaries`, async () => {
    const bytes = Buffer.from(Array.from({ length }, (_, i) => i % 256));
    const run = context();
    const reader = createInputReader(run.command, new MediaBudgetTracker({ maxInputBytes: length }));
    expect(await reader(`data:application/octet-stream;base64,${bytes.toString("base64")}`)).toEqual(new Uint8Array(bytes));
  });
}

it("counts inline and file inputs against one cumulative limit", async () => {
  const run = context();
  await run.command.fs.writeFile("/prefix", new Uint8Array(2));
  const admitted: number[] = [];
  const reader = createInputReader({ ...run.command, inputBudget: { maxBytes: 4, check(total) { admitted.push(total); } } }, new MediaBudgetTracker({ maxInputBytes: 4 }));
  await reader("/prefix");
  await reader("data:application/octet-stream;base64,AQI=");
  await expect(reader("data:application/octet-stream;base64,Aw==")).rejects.toThrow("maxInputBytes");
  expect(admitted).toEqual([2, 4, 5]);
});

it("honors caller input admission and cancellation for inline inputs", async () => {
  const run = context();
  const reader = createInputReader({ ...run.command, inputBudget: { maxBytes: 1, check() { throw new Error("caller limit"); } } }, new MediaBudgetTracker());
  await expect(reader(input)).rejects.toThrow("caller limit");
  const cancelled = createInputReader({ ...run.command, signal: AbortSignal.abort(new Error("cancelled input")) }, new MediaBudgetTracker());
  await expect(cancelled(input)).rejects.toThrow("cancelled input");
});

for (const value of ["data:audio/wav;base64", "data:audio/wav,AAAA", "data:audio/wav;base64,!!!!"]) {
  it(`rejects malformed inline input ${value} without publishing output`, async () => {
    const run = context(["-of", "json", "-show_streams", value]);
    const result = await createFfprobeCommand().execute(run.command);
    expect(result.exitCode).toBe(1);
    expect(run.output()).toBe("");
    expect(run.diagnostic()).not.toContain("ENOENT");
  });
}

it("rejects inline input over the byte limit without publishing output", async () => {
  const run = context(["-of", "json", "-show_streams", input]);
  const result = await createFfprobeCommand({ limits: { maxInputBytes: wav.length - 1 } }).execute(run.command);
  expect(result.exitCode).toBe(1);
  expect(run.output()).toBe("");
  expect(run.diagnostic()).toContain("maxInputBytes");
});

it("declines synchronous inline evaluation before looking up a literal filename", () => {
  const reads: string[] = [];
  expect(evalSyncFfprobe(undefined, ["-of", "json", input], path => { reads.push(path); return wav; })).toBeUndefined();
  expect(reads).toEqual([]);
});
