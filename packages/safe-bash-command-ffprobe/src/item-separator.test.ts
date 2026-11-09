import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";
import { probe } from "./probe.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80)] });

for (const writer of ["compact", "csv"]) for (const key of ["s", "item_sep"]) {
  for (const separator of ["", "ab", "é", ";"]) for (const explicit of [false, true]) {
    it(`validates ${writer} ${key}=${JSON.stringify(separator)} through ${explicit ? "media" : "audio"}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.wav", bytes);
      const args = [
        ...(explicit ? ["-f", "wav"] : []), "-v", "error", "-of", `${writer}${explicit ? "=" : ":"}${key}=${separator}`,
        "-show_entries", "format=filename,duration", "/input.wav"
      ];
      let stdout = "", stderr = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      if (separator === ";") {
        const expected = writer === "compact"
          ? "format;filename=/input.wav;duration=0.010000\n"
          : "format;/input.wav;0.010000\n";
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toBe(expected);
        expect(stderr).toBe("");
        expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(expected);
      } else {
        expect(result.exitCode).toBe(1);
        expect(stdout).toBe("");
        expect(stderr).toContain("Item separator must be a single byte");
        expect(evalSyncFfprobe(undefined, args, () => bytes)).toBeUndefined();
      }
    });
  }

  it.each(["", "ab", "é"])(`rejects invalid ${writer} ${key} in the audio writer: %j`, separator => {
    expect(() => probe(bytes, ["-of", `${writer}:${key}=${separator}`, "-show_format", "input.wav"]))
      .toThrow("Item separator must be a single byte");
  });
}
