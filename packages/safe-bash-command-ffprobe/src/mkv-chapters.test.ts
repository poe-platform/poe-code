import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// FFmpeg PCM Matroska with two FFMETADATA chapters; expected records from native ffprobe.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/chapters.mka", import.meta.url));
for (const route of ["file", "stdin"]) it(`reports Matroska chapter IDs, nanosecond timestamps and titles via ${route}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/meeting.mka", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-of", "json", "-show_chapters", route === "stdin" ? "-" : "/meeting.mka"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(JSON.parse(output)).toEqual({ chapters: [
    { id: 1, time_base: "1/1000000000", start: 0, start_time: "0.000000", end: 250000000, end_time: "0.250000", tags: { title: "Intro" } },
    { id: 2, time_base: "1/1000000000", start: 250000000, start_time: "0.250000", end: 1000000000, end_time: "1.000000", tags: { title: "Discussion" } }
  ] });
});
