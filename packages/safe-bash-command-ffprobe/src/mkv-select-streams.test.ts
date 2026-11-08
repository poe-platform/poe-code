import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/attachments.mkv", import.meta.url));

for (const route of ["file", "stdin", "sync"]) {
  for (const section of ["packet", "frame"]) {
    it.each(["s", "s:0", "2", "s:1", "a:1"])(`selects Matroska ${section} records for %s via ${route}`, async selector => {
      const args = ["-v", "error", "-of", "json", "-select_streams", selector,
        "-show_entries", `${section}=stream_index,pts`, route === "stdin" ? "-" : "/tracks.mkv"];
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
      const records = JSON.parse(output)[`${section}s`];
      if (selector === "s:1") expect(records).toEqual([]);
      else if (selector === "a:1") {
        expect(records.length).toBeGreaterThan(0);
        expect(records.every((record: { stream_index: number }) => record.stream_index === 1)).toBe(true);
      } else {
        expect(records).toHaveLength(1);
        if (section === "packet") expect(records[0]).toEqual({ stream_index: 2, pts: 100 });
        else expect(records[0]).toEqual({ pts: 100000 });
      }
    });
  }
}
