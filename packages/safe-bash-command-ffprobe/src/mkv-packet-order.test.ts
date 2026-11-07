import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Packet sequence verified with native ffprobe on these exact bytes.
const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/attachments.mkv", import.meta.url));
for (const subtitlePts of [100, 900]) {
  const bytes = new Uint8Array(fixture);
  // Change only the subtitle Block timestamp, leaving its demux position before the 128ms audio.
  new DataView(bytes.buffer).setInt16(5012, subtitlePts, false);
  for (const route of ["file", "stdin", "sync"]) {
    for (const selection of [undefined, "a:1"]) it(`preserves Matroska block order via ${route}, selection=${selection}, subtitlePts=${subtitlePts}`, async () => {
      const args = ["-v", "error", "-of", "json", ...(selection ? ["-select_streams", selection] : []), "-show_packets",
        "-show_entries", "packet=stream_index,pts",
        route === "stdin" ? "-" : "/tracks.mkv"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/tracks.mkv", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args),
          cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      const probe = JSON.parse(output);
      const audio = Array.from({ length: 8 }, (_, i) => ({ stream_index: 1, pts: i * 128 }));
      const interleaved = audio.flatMap(packet => [{ ...packet, stream_index: 0 }, packet]);
      interleaved.splice(2, 0, { stream_index: 2, pts: subtitlePts });
      expect(probe.packets).toEqual(selection ? audio : interleaved);
    });
  }
}
