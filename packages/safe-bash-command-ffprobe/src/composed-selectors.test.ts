import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const mkv = readFileSync(new URL("../../mp4-ast/src/fixtures/attachments.mkv", import.meta.url));
const m4a = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/m4a-cover.m4a", import.meta.url));

for (const route of ["file", "stdin", "sync"]) {
  it.each([
    [mkv, "a:m:title:Bob", [1]],
    [mkv, "a:m:language:fra", [1]],
    [mkv, "a:m:TITLE:Bob", [1]],
    [mkv, "a:m:title:bob", []],
    [mkv, "a:m:language", [0, 1]],
    [mkv, "a:m:missing", []],
    [mkv, "a:v", []],
    [mkv, "a:a:1", [1]],
    [mkv, "a:1", [1]],
    [mkv, "m:title:Bob", [1]],
    [m4a, "a:i:1", [0]],
    [m4a, "a:#1", [0]],
    [m4a, "a:#0x1", [0]],
    [m4a, "a:1", []],
  ] as const)(`selects streams and packets with selector %# via ${route}`, async (bytes, selector, indices) => {
    for (const section of ["stream", "packet"]) {
      const args = ["-v", "error", "-select_streams", selector, "-show_entries",
        `${section}=${section === "stream" ? "index" : "stream_index"}`, "-of", "json", route === "stdin" ? "-" : "/input"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
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
      const records = JSON.parse(output)[`${section}s`] as Record<string, number>[];
      expect([...new Set(records.map(record => record[section === "stream" ? "index" : "stream_index"]))]).toEqual(indices);
    }
  });
}
