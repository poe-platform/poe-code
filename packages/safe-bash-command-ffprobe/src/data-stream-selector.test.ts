import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

// Native ffprobe results for these unchanged MP4 bytes.
const stream = { index: 1, codec_type: "data", codec_tag_string: "tmcd" };
const packet = {
  codec_type: "data", stream_index: 1, pts: 0, pts_time: "0.000000", dts: 0,
  dts_time: "0.000000", duration: 1536, duration_time: "0.120000", size: "4",
  pos: "48", flags: "K__", data: "\n00000000: 0001 6b97                                ..k.\n"
};

for (const fixture of ["data-timecode", "data-absent"]) {
  const bytes = readFileSync(new URL(`./fixtures/${fixture}.mp4`, import.meta.url));
  for (const selector of ["d", "d:0", "d:1"]) {
    for (const section of ["streams", "packets", "interval"]) {
      for (const route of ["file", "stdin", "sync"]) {
        if (section === "interval" && route === "sync") continue;
        it(`selects ${fixture} ${section} with ${selector} via ${route}`, async () => {
          const args = ["-v", "error", "-select_streams", selector, "-of", "json",
            ...(section === "streams"
              ? ["-show_streams", "-show_entries", "stream=index,codec_type,codec_tag_string:stream_tags=:stream_disposition=:stream_side_data="]
              : ["-show_packets", "-show_data"]),
            ...(section === "interval" ? ["-read_intervals", "%+#1"] : []),
            route === "stdin" ? "-" : "/input.mp4"];
          let output = "", diagnostic = "";
          if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
          else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/input.mp4", bytes);
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
          const selected = fixture === "data-timecode" && selector !== "d:1";
          expect(JSON.parse(output)[section === "streams" ? "streams" : "packets"])
            .toEqual(selected ? [section === "streams" ? stream : packet] : []);
        });
      }
    }
  }
}
