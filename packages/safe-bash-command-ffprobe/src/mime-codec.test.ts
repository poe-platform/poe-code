import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [fixture, codecs] of [
  ["mp4-ast/src/fixtures/aac-external.mp4", ["avc1.640016", "mp4a.40.2"]],
  ["safe-bash-command-audio/fixtures/tone.m4a", ["mp4a.40.2"]],
  ["safe-bash-command-audio/fixtures/tone.flac", ["flac"]],
  ["safe-bash-command-audio/fixtures/cbr.mp3", ["mp4a.40.34"]],
  ["safe-bash-command-audio/fixtures/tone.ogg", ["vorbis"]],
  ["safe-bash-command-audio/fixtures/s16.wav", [undefined]]
] as const) {
  for (const mode of ["file", "stdin", "sync", ...(fixture.endsWith(".mp4") ? ["source-file", "source-stdin"] : [])]) {
    for (const selected of [false, true]) {
      it(`reports MIME codecs for ${fixture} via ${mode}, selected=${selected}`, async () => {
        const bytes = readFileSync(new URL(`../../${fixture}`, import.meta.url));
        const args = ["-v", "error", ...(mode.startsWith("source-") ? ["-f", "mp4"] : []), ...(selected ? ["-show_entries", "stream=index,mime_codec_string"] : ["-show_streams"]), "-of", "json", mode.endsWith("file") ? "/input" : "-"];
        let output = "", diagnostic = "";
        if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/input", bytes);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
        }
        const streams = JSON.parse(output).streams;
        expect(streams).toHaveLength(codecs.length);
        codecs.forEach((codec, index) => {
          expect(streams[index].mime_codec_string).toBe(codec);
          if (selected) expect(streams[index]).toEqual({ index, ...(codec ? { mime_codec_string: codec } : {}) });
        });
      });
    }
  }
}
