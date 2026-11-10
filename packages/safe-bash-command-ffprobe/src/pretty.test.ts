import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

// Native ffprobe 7.0.2: tagged 8 kHz PCM WAV, 4096 audio bytes, 4166 total bytes.
const bytes = Buffer.concat([
  Buffer.from("524946463e10000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c65006461746100100000", "hex"),
  Buffer.alloc(4096)
]);

for (const explicit of [false, true]) {
  for (const [flags, expected] of [
    [[], "sample_rate=8000\nduration=0.256000\nsize=4166\n"],
    [["-sexagesimal"], "sample_rate=8000\nduration=0:00:00.256000\nsize=4166\n"],
    [["-pretty"], "sample_rate=8 KHz\nduration=0:00:00.256000\nsize=4.068359 Kibyte\n"],
    [["-unit", "-prefix", "-byte_binary_prefix", "-sexagesimal"], "sample_rate=8 KHz\nduration=0:00:00.256000\nsize=4.068359 Kibyte\n"]
  ] as const) {
    it(`formats the presentation preset (explicit=${explicit}, flags=${flags.join(" ")})`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/large.wav", bytes);
      const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), ...flags,
        "-of", "default=nw=1", "-show_entries", "stream=sample_rate,duration:format=size", "/large.wav"];
      let output = "", error = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
      });
      expect(error).toBe("");
      expect(result.exitCode).toBe(0);
      expect(output).toBe(expected);
      expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(expected);
    });
  }
}
