import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

const audioBytes = readFileSync(new URL("../../mp4-ast/src/fixtures/chapters.mka", import.meta.url));
// Native ffprobe on these exact fixture bytes (positions include container headers).
const positions = [642, 2697, 4752, 6807, 8862, 10917, 12972, 15027].map(String);
const sizes = [2048, 2048, 2048, 2048, 2048, 2048, 2048, 1664].map(String);
const groupedBytes = readFileSync(new URL("../../mp4-ast/src/fixtures/attachments.mkv", import.meta.url));
for (const route of ["file", "stdin"]) {
  for (const kind of ["packets", "frames", "grouped packets"]) {
    const grouped = kind === "grouped packets";
    const section = grouped ? "packets" : kind;
    const bytes = grouped ? groupedBytes : audioBytes;
    it(`reports native Matroska ${kind} positions via ${route}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/meeting.mka", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(["-v", "error", "-of", "json", `-show_${section}`, route === "stdin" ? "-" : "/meeting.mka"]),
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const records = JSON.parse(output)[section] as Record<string, string>[];
      if (grouped) {
        // Native subtitle packet: BlockGroup contains Block, then BlockDuration.
        expect(records.find(record => Number(record.stream_index) === 2)).toMatchObject({ pos: "5011", size: "5" });
        return;
      }
      expect(records.map(record => record[kind === "packets" ? "pos" : "pkt_pos"])).toEqual(positions);
      expect(records.map(record => record[kind === "packets" ? "size" : "pkt_size"])).toEqual(sizes);
    });
  }
}
