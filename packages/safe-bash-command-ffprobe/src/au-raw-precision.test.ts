import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe reports raw precision only for the wide integer AU encodings.
for (const [encoding, codec, sampleFormat, bits, rawBits] of [
  [3, "pcm_s16be", "s16", 16, undefined],
  [4, "pcm_s24be", "s32", 24, "24"],
  [5, "pcm_s32be", "s32", 32, "32"],
  [6, "pcm_f32be", "flt", 32, undefined],
  [7, "pcm_f64be", "dbl", 64, undefined]
] as const) for (const file of [false, true]) {
  it(`reports AU ${codec} raw precision via ${file ? "file" : "stdin"}`, async () => {
    const payloadSize = 96 * 2 * bits / 8;
    const bytes = new Uint8Array(32 + payloadSize);
    const header = new DataView(bytes.buffer);
    [0x2e736e64, 32, payloadSize, encoding, 8000, 2].forEach((value, index) => header.setUint32(index * 4, value));
    const fs = new MemoryFileSystem();
    if (file) await fs.writeFile("/input.au", bytes);
    const expected = {
      codec_name: codec, sample_fmt: sampleFormat, bits_per_sample: bits,
      ...(rawBits === undefined ? {} : { bits_per_raw_sample: rawBits })
    };
    for (const selection of [["-show_streams"], ["-show_entries", "stream=codec_name,sample_fmt,bits_per_sample,bits_per_raw_sample"]]) {
      const args = ["-v", "error", ...selection, "-of", "json", file ? "/input.au" : "-"];
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const stream = JSON.parse(output).streams[0];
      expect(stream).toMatchObject(expected);
      if (rawBits === undefined) expect(stream).not.toHaveProperty("bits_per_raw_sample");
      if (selection[0] === "-show_entries") expect(stream).toEqual(expected);
      expect(output).toBe(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes));
    }
  });
}
