import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const cases: { name: string; bytes: Uint8Array; sampleFormat: string }[] = [];
for (const [bitsPerSample, float, sampleFormat] of [
  [8, false, "u8"], [16, false, "s16"], [24, false, "s32"],
  [32, false, "s32"], [32, true, "flt"], [64, true, "dbl"]
] as const) {
  cases.push({ name: `pcm-${bitsPerSample}-${float}.wav`, sampleFormat,
    bytes: encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }, { bitsPerSample, float }) });
}
for (const bits of [16, 24]) {
  const bytes = new Uint8Array(42);
  bytes.set(new TextEncoder().encode("fLaC"));
  bytes.set([128, 0, 0, 34], 4);
  new DataView(bytes.buffer).setBigUint64(18, (48000n << 44n) | (BigInt(bits - 1) << 36n) | 12000n);
  cases.push({ name: `${bits}.flac`, bytes, sampleFormat: bits === 16 ? "s16" : "s32" });
}
const mp3 = new Uint8Array(834);
mp3.set([255, 251, 144, 0]);
mp3.set([255, 251, 144, 0], 417);
cases.push({ name: "tone.mp3", bytes: mp3, sampleFormat: "fltp" });

it.each(cases)("reports decoded sample format for $name", async ({ name, bytes, sampleFormat }) => {
  const fs = new MemoryFileSystem();
  const path = `/${name}`;
  await fs.writeFile(path, bytes);
  for (const selection of [["-show_streams"], ["-show_entries", "stream=sample_fmt"]]) {
    const args = ["-of", "json", ...selection, path];
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).streams[0].sample_fmt).toBe(sampleFormat);
    expect(output).toBe(evalSyncFfprobe(undefined, args, () => bytes));
    if (selection[0] === "-show_entries")
      expect(JSON.parse(output)).toEqual({ programs: [], stream_groups: [], streams: [{ sample_fmt: sampleFormat }] });
  }
});
