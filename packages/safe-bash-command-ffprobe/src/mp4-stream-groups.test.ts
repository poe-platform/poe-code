import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { probeMp4 } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

for (const fixture of [
  "packet-positions-interleaved", "packet-positions-faststart",
  "packet-positions-fragmented", "aac-external", "h264-b-frames"
]) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}.mp4`, import.meta.url));
  it(`reports zero stream groups in buffered ${fixture} metadata`, () => {
    expect(probeMp4(bytes).format).toHaveProperty("nb_stream_groups", 0);
  });

  for (const selection of [
    ["-show_format"],
    ["-show_entries", "format=nb_streams,nb_programs,nb_stream_groups"]
  ]) {
    it(`reports zero stream groups for ${fixture} with ${selection.join(" ")}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/clip.mp4", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe",
        ...createCommandArguments(["-v", "error", ...selection, "-of", "json", "/clip.mp4"]),
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(JSON.parse(output).format).toMatchObject({
        nb_streams: ["h264-b-frames", "packet-positions-faststart"].includes(fixture) ? 1 : 2,
        nb_programs: 0,
        nb_stream_groups: 0
      });
    });
  }
}
