import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffmpeg AAC fixture, with -metadata key=value for every expected tag.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/album-tags.m4a", import.meta.url));
const expected = { title: "One", artist: "Solo", album_artist: "Band", composer: "Writer",
  track: "3/12", disc: "1/2", compilation: "1", copyright: "Studio", description: "Session" };

for (const route of ["file", "stdin", "sync"] as const) {
  it(`reports native iTunes album tags through ${route}`, async () => {
    const args = ["-v", "error", "-show_format", "-of", "json", route === "stdin" ? "-" : "/album.m4a"];
    let output = "", diagnostic = "";
    if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
    else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/album.m4a", bytes);
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
    }
    const tags = JSON.parse(output).format.tags;
    expect(tags).toMatchObject(expected);
    for (const key of ["albumArtist", "trackNumber", "discNumber"]) expect(tags).not.toHaveProperty(key);
  });
}
