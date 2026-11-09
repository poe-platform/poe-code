import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const fixture of ["wav-multiple-data.wav", "wav-multiple-data-gap.wav"]) {
  for (const target of ["pipe:0", "/input.wav"]) {
    for (const extra of [[], ["-f", "wav"], ["-show_data_hash", "sha256"], ["-count_packets", "-count_frames"]]) {
      it(`reports every PCM chunk from ${fixture} ${target} ${extra.join(" ")}`, async () => {
        const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
        const args = ["-v", "error", ...extra, "-show_entries", "packet=pts,size,pos:stream=nb_read_packets,nb_read_frames", "-of", "json", target];
        const last = { pts: target === "pipe:0" ? 4 : 0, size: "6", pos: fixture.includes("gap") ? "72" : "60" };
        const expected = target === "pipe:0" ? [{ pts: 0, size: "8", pos: "44" }, last] : [last];
        const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3); } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        expect(JSON.parse(output).packets).toEqual(expected);
        const sync = JSON.parse(evalSyncFfprobe(target === "pipe:0" ? bytes : undefined, args, () => bytes)!);
        expect(sync.packets).toEqual(expected);
        if (extra.includes("-count_packets")) {
          const counts = [{ nb_read_packets: String(expected.length), nb_read_frames: String(expected.length) }];
          expect(JSON.parse(output).streams).toEqual(counts);
          expect(sync.streams).toEqual(counts);
        }
      });
    }
  }
}
