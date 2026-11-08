import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/comments.flac", import.meta.url));
const expected = { title: "Meeting", ARTIST: "Alice;Bob", album_artist: "Band", track: "2", disc: "1", comment: "Notes" };
for (const route of ["file", "stdin", "sync"]) it(`reports FLAC Vorbis comments only at format scope via ${route}`, async () => {
  const args = ["-v", "error", "-show_entries", "stream=codec_name:stream_tags:format_tags", "-of", "json", route === "stdin" ? "-" : "/in.flac"];
  let output = "", diagnostic = "";
  if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
  else {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.flac", bytes);
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
  }
  const result = JSON.parse(output);
  expect(result.format.tags).toEqual(expected);
  expect(result.streams).toEqual([{ codec_name: "flac" }]);
});
