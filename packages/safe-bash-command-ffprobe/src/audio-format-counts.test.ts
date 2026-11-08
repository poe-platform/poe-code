import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

const native = JSON.parse(readFileSync(new URL("../../safe-bash-command-audio/fixtures/ffprobe.json", import.meta.url), "utf8"));

for (const fixture of ["s16.wav", "tone.flac", "cbr.mp3"]) {
  const bytes = readFileSync(new URL(`../../safe-bash-command-audio/fixtures/${fixture}`, import.meta.url));
  for (const mode of ["file", "stdin"]) {
    for (const selection of [
      ["-show_format"],
      ["-show_entries", "format=nb_streams,nb_programs,nb_stream_groups"]
    ]) {
      it(`matches native format counts for ${fixture} via ${mode} with ${selection.join(" ")}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile(`/input.${fixture}`, bytes);
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe",
          ...createCommandArguments(["-v", "quiet", ...selection, "-of", "json", "-i", mode === "stdin" ? "-" : `/input.${fixture}`]),
          cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        const { nb_streams, nb_programs, nb_stream_groups } = native[fixture].format;
        const expected = { nb_streams, nb_programs, nb_stream_groups };
        if (selection[0] === "-show_entries") expect(JSON.parse(output).format).toEqual(expected);
        else expect(JSON.parse(output).format).toMatchObject(expected);
      });
    }
  }
}
