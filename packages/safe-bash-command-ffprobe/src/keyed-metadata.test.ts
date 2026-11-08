import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native FFmpeg fixture generated with -movflags +use_metadata_tags.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/keyed.m4a", import.meta.url));
const expected = { title: "Meeting", session_id: "abc123" };

for (const route of ["file", "stdin", "sync"] as const) {
  it(`reports native keyed metadata through ${route}`, async () => {
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
  });
}
