import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// Native FFmpeg PCM Matroska; expected metadata verified with native ffprobe.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/chapters.mka", import.meta.url));
for (const route of ["file", "stdin"]) it(`reports container codec tags for Matroska PCM via ${route}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/meeting.mka", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-of", "json", "-show_entries", "stream=codec_name,codec_tag_string,codec_tag", route === "stdin" ? "-" : "/meeting.mka"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const probe = JSON.parse(output);
  expect(probe.streams).toEqual([{
    codec_name: "pcm_s16le",
    codec_tag_string: "[0][0][0][0]",
    codec_tag: "0x0000"
  }]);
});
