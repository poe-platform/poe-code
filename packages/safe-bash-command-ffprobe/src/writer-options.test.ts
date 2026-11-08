import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";
import { parseArguments } from "./probe.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
const invalid = ["json=nokey=1", "json=nw=1", "json=s=,", "default=c=1", "default=p=0", "compact=nw=1", "csv=compact=1", "flat=nk=1", "ini=nk=1"];

for (const writer of invalid) for (const section of ["packet=size", "stream=index"]) {
  it(`rejects ${writer} before emitting ${section}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.wav", bytes);
    const args = ["-v", "error", "-of", "json", "-of", writer, "-show_entries", section, "/input.wav"];
    let output = "", error = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode).toBe(1);
    expect(output).toBe("");
    expect(error).toContain("Unsupported writer option");
    expect(evalSyncFfprobe(bytes, args, () => bytes)).toBeUndefined();
  });
}

it.each(invalid)("rejects invalid options in the audio parser: %s", writer => {
  expect(() => parseArguments(["-of", writer.replace("=", ":"), "input.wav"])).toThrow("Unsupported writer option");
});

it.each(["json", "json=c=1", "json=compact=1", "default=nk=1:nw=1", "default=nokey=1:noprint_wrappers=1", "compact=nk=1:p=0:s=,", "csv=nokey=0:print_section=0:item_sep=|", "flat", "ini=h=0", "ini=hierarchical=0"])("preserves valid options: %s", writer => {
  const output = evalSyncFfprobe(bytes, ["-of", writer, "-show_entries", "packet=size", "-"]);
  expect(output).toContain("32");
});
