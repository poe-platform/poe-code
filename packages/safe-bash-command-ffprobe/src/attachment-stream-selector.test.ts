import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

// Native ffprobe selects attachment stream 3; attachments have no packets.
for (const fixture of ["attachments", "data-absent"]) {
  const bytes = readFileSync(new URL(fixture === "attachments" ? "../../mp4-ast/src/fixtures/attachments.mkv" : "./fixtures/data-absent.mp4", import.meta.url));
  const filename = fixture === "attachments" ? "/input.mkv" : "/input.mp4";
  for (const selector of ["t", "t:0", "t:1"]) {
    for (const section of ["streams", "packets", "interval"]) {
      for (const route of ["file", "stdin", "sync"]) {
        if (section === "interval" && route === "sync") continue;
        it(`selects ${fixture} ${section} with ${selector} via ${route}`, async () => {
          const args = ["-v", "error", "-select_streams", selector, "-of", "json",
            ...(section === "streams"
              ? ["-show_streams", "-show_entries", "stream=index,codec_type:stream_tags=:stream_disposition=:stream_side_data="]
              : ["-show_packets"]),
            ...(section === "interval" ? ["-read_intervals", "%+#1"] : []),
            route === "stdin" ? "-" : filename];
          let output = "", diagnostic = "";
          if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
          else {
            const fs = new MemoryFileSystem();
            await fs.writeFile(filename, bytes);
            const result = await createFfprobeCommand().execute({
              command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
              signal: new AbortController().signal,
              stdin: { async *[Symbol.asyncIterator]() { if (route === "stdin") yield bytes; } },
              stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
              stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
            });
            expect(result.exitCode, diagnostic).toBe(0);
            expect(diagnostic).toBe("");
          }
          const selected = section === "streams" && fixture === "attachments" && selector !== "t:1";
          expect(JSON.parse(output)[section === "streams" ? "streams" : "packets"])
            .toEqual(selected ? [{ index: 3, codec_type: "attachment" }] : []);
        });
      }
    }
  }
}
