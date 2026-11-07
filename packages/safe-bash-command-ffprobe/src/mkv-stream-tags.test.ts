import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// Native FFmpeg PCM Matroska; expected metadata verified with native ffprobe.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/stream-tags.mka", import.meta.url));
for (const route of ["file", "stdin"]) it(`preserves Matroska stream names and UID-scoped tags via ${route}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/meeting.mka", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-of", "json", "-show_entries", "stream_tags:format_tags", route === "stdin" ? "-" : "/meeting.mka"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const probe = JSON.parse(output);
  expect(probe.streams.map((stream: { tags: Record<string, string> }) => stream.tags)).toEqual([
    { language: "eng", title: "Alice", ENCODER: "Lavc63.1.101 pcm_s16le", DURATION: "00:00:01.000000000" },
    { language: "fra", title: "Bob", ENCODER: "Lavc63.1.101 pcm_s16le", DURATION: "00:00:01.000000000" },
    { DURATION: "00:00:00.400000000" }
  ]);
  expect(probe.format.tags.title).toBe("Meeting");
  expect(probe.format.tags).not.toHaveProperty("DURATION");
});
