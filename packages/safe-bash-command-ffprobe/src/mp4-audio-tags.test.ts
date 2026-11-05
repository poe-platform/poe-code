import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Fragmented AAC MP4 generated with ffmpeg, with container title and artist.
const bytes = readFileSync(new URL("./fixtures/audio-tags.mp4", import.meta.url));

for (const route of ["file", "stdin", "sync"]) {
  for (const selected of [false, true]) for (const writer of ["json", "default"]) {
    it(`keeps MP4 audio stream tags separate from container tags: ${route}, selected=${selected}, ${writer}`, async () => {
      const args = ["-v", "error", "-show_entries", selected
        ? "stream_tags=language,handler_name,title,artist:format_tags=title,artist,encoder"
        : "stream_tags:format_tags", "-of", writer, "-i", route === "file" ? "/audio.mp4" : "-"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/audio.mp4", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args),
          cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { if (route === "stdin") yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      if (writer === "json") {
        const result = JSON.parse(output);
        expect(result.streams).toEqual([{ tags: { language: "und", handler_name: "SoundHandler" } }]);
        expect(result.format.tags).toMatchObject({ title: "Audit tone", artist: "Test", encoder: "Lavf63.1.101" });
      } else {
        expect(output.split("[FORMAT]")[0]).toBe("[STREAM]\nTAG:language=und\nTAG:handler_name=SoundHandler\n[/STREAM]\n");
        expect(output.split("[FORMAT]")[1]).toContain("TAG:title=Audit tone\nTAG:artist=Test\nTAG:encoder=Lavf63.1.101\n");
      }
    });
  }
}
