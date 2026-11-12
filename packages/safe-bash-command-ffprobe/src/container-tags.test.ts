import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { writeAudioMetadata } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

for (const fixture of ["stdin.mp3", "unknown-duration.flac"]) {
  for (const file of [false, true]) {
    it(`keeps ${fixture} container tags out of stream tags via ${file ? "file" : "stdin"}`, async () => {
      const bytes = writeAudioMetadata(
        new Uint8Array(readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url))),
        { title: "Audit tone", artist: "Test" }
      );
      const fs = new MemoryFileSystem();
      if (file) await fs.writeFile("/" + fixture, bytes);
      const args = ["-v", "error", "-show_entries", "format_tags=title,artist:stream_tags", "-i", file ? "/" + fixture : "-"];
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      // Native ffprobe reports these tags only in FORMAT, leaving STREAM empty.
      const expected = `[STREAM]\n[/STREAM]\n[FORMAT]\nTAG:title=Audit tone\nTAG:artist=Test\n[/FORMAT]\n`;
      expect(result.exitCode, diagnostic).toBe(0);
      expect(output).toBe(expected);
      expect(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)).toBe(expected);
    });
  }
}
