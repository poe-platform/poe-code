import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const explicit of [false, true]) for (const stdin of [false, true])
for (const writer of ["json", "default", "flat", "csv", "compact", "ini"])
for (const mode of [undefined, "auto", "always", "never"]) {
  it(`prints optional fields: ${writer}, ${mode}, explicit=${explicit}, stdin=${stdin}`, async () => {
    const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
    const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []),
      "-of", "json", "-of", writer, ...(mode ? ["-show_optional_fields", mode] : []),
      "-show_entries", "stream=nb_frames,nb_read_frames,sample_rate,not_a_field", stdin ? "-" : "/input.wav"];
    const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
    let output = "", error = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
    });
    expect(error).toBe(""); expect(result.exitCode).toBe(0);
    const show = mode === "always" || mode !== "never" && writer !== "json";
    for (const text of [output, evalSyncFfprobe(bytes, args, () => bytes)!]) {
      expect(text.includes("N/A")).toBe(show);
      expect(text).toContain("8000"); expect(text).not.toContain("not_a_field");
      if (writer === "json") expect(JSON.parse(text).streams).toEqual([
        { sample_rate: "8000", ...(show ? { nb_frames: "N/A", nb_read_frames: "N/A" } : {}) }
      ]);
    }
  });
}

it("preserves measured frame counts when optional fields are disabled", () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
  const output = evalSyncFfprobe(bytes, ["-show_optional_fields", "never", "-count_frames",
    "-show_entries", "stream=nb_frames,nb_read_frames", "-of", "json", "-"])!;
  expect(JSON.parse(output).streams).toEqual([{ nb_read_frames: "1" }]);
});

it("rejects invalid optional-field modes before reading input", async () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
  const args = ["-show_optional_fields", "invalid", "-"];
  expect(evalSyncFfprobe(bytes, args)).toBeUndefined();
  let error = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { throw new Error("must not read input"); } },
    stdout: { async write() { throw new Error("must not publish output"); } },
    stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode).toBe(1);
  expect(error).toContain("Invalid show_optional_fields value");
});
