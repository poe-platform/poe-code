import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// Native FFmpeg fixture; dispositions verified with native ffprobe.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/track-dispositions.mkv", import.meta.url));
for (const route of ["file", "stdin"]) it(`reports encoded Matroska track dispositions via ${route}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/meeting.mka", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-of", "json", "-show_entries", "stream_disposition=default,forced,hearing_impaired", route === "stdin" ? "-" : "/meeting.mka"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const probe = JSON.parse(output);
  expect(probe.streams.map((stream: { disposition: Record<string, number> }) => stream.disposition)).toEqual([
    { default: 0, forced: 0, hearing_impaired: 0 },
    { default: 1, forced: 0, hearing_impaired: 1 },
    { default: 0, forced: 1, hearing_impaired: 0 }
  ]);
});
